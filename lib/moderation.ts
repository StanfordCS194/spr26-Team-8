/**
 * Upload guardrails. Called from archive.tsx before any file/row is written
 * to Supabase:
 *   - moderateUpload     — OpenAI omni-moderation (harmful content)
 *   - checkImageContext  — Claude Haiku (is the image usable / not garbage)
 *
 * Both fail-open by design: if a key is missing or the API errors, we warn and
 * allow the upload through rather than blocking on a single-vendor outage.
 */

export type ModerationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

type ModerationApiResponse = {
  results?: {
    flagged?: boolean;
    categories?: Record<string, boolean>;
  }[];
};

export async function moderateUpload(params: {
  base64: string;
  mimeType: string;
  caption?: string;
}): Promise<ModerationResult> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OpenAI moderation key not set; allowing upload");
    return { allowed: true };
  }

  const input: unknown[] = [
    {
      type: "image_url",
      image_url: { url: `data:${params.mimeType};base64,${params.base64}` },
    },
  ];
  const trimmedCaption = params.caption?.trim();
  if (trimmedCaption) {
    input.push({ type: "text", text: trimmedCaption });
  }

  let json: ModerationApiResponse;
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });
    if (!res.ok) {
      console.warn(`OpenAI moderation HTTP ${res.status}; allowing upload`);
      return { allowed: true };
    }
    json = (await res.json()) as ModerationApiResponse;
  } catch (err) {
    console.warn("OpenAI moderation request failed; allowing upload", err);
    return { allowed: true };
  }

  const result = json.results?.[0];
  if (!result?.flagged) return { allowed: true };

  const flaggedCategories = Object.entries(result.categories ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  const reason = flaggedCategories.length > 0 ? flaggedCategories.join(", ") : "flagged";
  return { allowed: false, reason };
}

export type ContextCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

type AnthropicMessagesResponse = {
  content?: { text?: string }[];
};

const CONTEXT_PROMPT = [
  "Reply with only one word: YES or NO.\n",
  "NO only if the image is unusable for a personal memory archive — blank,",
  "totally blurry beyond recognition, accidental lens-cap/pocket shot, or a screenshot with no real content.\n",
  "Otherwise YES, even for ordinary objects and scenes. Be lenient with YES.",
].join("\n");

export async function checkImageContext(params: {
  base64: string;
  mimeType: string;
}): Promise<ContextCheckResult> {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.warn("Anthropic key not set; skipping image-context check");
    return { ok: true };
  }

  let json: AnthropicMessagesResponse;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: params.mimeType,
                  data: params.base64,
                },
              },
              { type: "text", text: CONTEXT_PROMPT },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(`Anthropic context-check HTTP ${res.status}; allowing upload`);
      return { ok: true };
    }
    json = (await res.json()) as AnthropicMessagesResponse;
  } catch (err) {
    console.warn("Anthropic context-check request failed; allowing upload", err);
    return { ok: true };
  }

  const text = json.content?.[0]?.text?.trim().toUpperCase() ?? "";
  if (text.startsWith("NO")) {
    return { ok: false, reason: "looks blank, blurry, or has no real content" };
  }
  return { ok: true };
}
