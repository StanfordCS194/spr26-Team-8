/**
 * Teammate integration stubs — replace bodies when Supabase, embeddings, or chat API are ready.
 * Flip flags in PLACEHOLDER_FLAGS to opt into behavior while implementations are WIP.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import type { ArchiveItemMeta } from "@/lib/archiveSearchAndCluster";
import { supabase } from "@/lib/supabase";

/** Toggle pieces of the pipeline as each teammate ships their slice. */
export const PLACEHOLDER_FLAGS = {
  /** Medhya / backend: fetch tags (or full artifact row) from Supabase by archive id */
  useRemoteArchiveMeta: false,
  /** Aaron / ML: override UI “theme” cluster from embedding / guardrail pipeline */
  useEmbeddingThemeOverrides: false,
  /** Optional: POST archive index snapshot after local index changes */
  usePushArchiveIndex: false,
  /** Siya / chat: call real generative endpoint instead of canned text */
  useGenerativeChatApi: true,
  /**
   * Vision / OCR — calls Claude Haiku with the image and stores the description in
   * memories.ocr_description and the local search index.
   */
  useVisionTextExtraction: true,
} as const;

export type ArchiveIdRef = { id: string; fileName: string };

/**
 * TODO: Medhya — query Supabase (or REST) for tags / labels keyed by `id` or storage path.
 * Return only fields you have; empty object = keep local filename-only tags.
 */
export async function placeholder_fetchRemoteArchiveMeta(
  _items: ArchiveIdRef[],
): Promise<Record<string, Partial<ArchiveItemMeta>>> {
  if (!PLACEHOLDER_FLAGS.useRemoteArchiveMeta) return {};
  // Example future shape:
  // return { "uploaded-123.jpg": { tags: ["restaurant", "nyc"] } };
  return {};
}

/**
 * TODO: Aaron — return deterministic theme/cluster label per id from embeddings + policy.
 * Empty object = use local keyword-based `inferTheme` only.
 */
export async function placeholder_fetchEmbeddingThemeOverrides(
  _items: ArchiveIdRef[],
): Promise<Record<string, string>> {
  if (!PLACEHOLDER_FLAGS.useEmbeddingThemeOverrides) return {};
  return {};
}

/**
 * TODO: Medhya — `payload` matches `archiveIndexForBackend` rows; fire-and-forget is fine.
 */
export async function placeholder_notifyArchiveIndexUpdated(
  _payload: unknown,
): Promise<void> {
  if (!PLACEHOLDER_FLAGS.usePushArchiveIndex) return;
}

/**
 * TODO: Siya — replace with fetch to your chat / completions route (body + user id + context).
 * For now returns canned copy so the Action UI can be exercised without a server.
 */
export async function placeholder_sendChatMessage(
  userText: string,
): Promise<string> {
  if (!PLACEHOLDER_FLAGS.useGenerativeChatApi) {
    return `Echo: ${userText.trim() || "(empty)"}`;
  }
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_OPENAI_API_KEY. Add it to your .env and restart Expo."
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    throw new Error("You need to sign in before using chat.");
  }

  const { data: memoryRows, error: memoryError } = await supabase
    .from("memories")
    .select("ocr_description")
    .eq("user_id", userId)
    .not("ocr_description", "is", null)
    .order("memory_id", { ascending: false })
    .limit(80);

  if (memoryError) {
    throw new Error(`Could not load memory context: ${memoryError.message}`);
  }

  const descriptions = (memoryRows ?? [])
    .map((row) => row.ocr_description?.trim())
    .filter((text): text is string => Boolean(text));

  const memoryContext =
    descriptions.length > 0
      ? descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")
      : "No OCR descriptions are available yet.";

  const systemPrompt =
    "You are a planning assistant for the user's saved memories.\n" +
    "Use ONLY the provided OCR memory descriptions as grounding context.\n" +
    "When asked for a bucket list or itinerary, synthesize ideas from those memories.\n" +
    "If context is sparse, say so and provide a best-effort draft.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `OCR memory descriptions:\n${memoryContext}\n\n` +
            `User request: ${userText.trim()}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      `OpenAI chat error ${response.status}: ${errBody.error?.message ?? "unknown error"}`
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  return content;
}

export type VisionExtractContext = {
  id: string;
  fileName: string;
  mimeType: string;
};

/**
 * Sends the image to Claude Haiku and returns a plain-text description for search indexing.
 * Result is stored in memories.ocr_description and merged into the local search blob.
 */
export async function placeholder_extractSearchableTextFromImage(
  localFileUri: string,
  ctx: VisionExtractContext,
): Promise<string> {
  if (!PLACEHOLDER_FLAGS.useVisionTextExtraction) return "";
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    if (__DEV__) {
      console.warn(
        "[Vision] EXPO_PUBLIC_ANTHROPIC_API_KEY is not set; upload continues without a generated description. Add the key to .env to enable Claude Haiku image tagging (see .env.example)."
      );
    }
    return "";
  }

  // Resize to max 1568px and compress to stay under Anthropic's 5MB image limit
  const resized = await ImageManipulator.manipulateAsync(
    localFileUri,
    [{ resize: { width: 1568 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  const base64 = await FileSystem.readAsStringAsync(resized.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: base64,
              },
            },
            {
              type: "text",
              text: "Return a comma separated list of tags and/or description of the image",
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Vision API error ${res.status}: ${errBody.error?.message ?? "unknown error"}`);
  }
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.[0]?.text;
  if (!text) throw new Error("Vision API returned no content");
  return text;
}
