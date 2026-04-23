/**
 * Upload guardrail: OpenAI omni-moderation-latest.
 * Called from archive.tsx before any file/row is written to Supabase.
 *
 * Fail-open by design: if the key is missing or the API errors, we warn and
 * allow the upload through rather than blocking on a moderation outage.
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
