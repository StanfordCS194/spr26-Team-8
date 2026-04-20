/**
 * Teammate integration stubs — replace bodies when Supabase, embeddings, or chat API are ready.
 * Flip flags in PLACEHOLDER_FLAGS to opt into behavior while implementations are WIP.
 */

import type { ArchiveItemMeta } from "@/lib/archiveSearchAndCluster";

/** Toggle pieces of the pipeline as each teammate ships their slice. */
export const PLACEHOLDER_FLAGS = {
  /** Medhya / backend: fetch tags (or full artifact row) from Supabase by archive id */
  useRemoteArchiveMeta: false,
  /** Aaron / ML: override UI “theme” cluster from embedding / guardrail pipeline */
  useEmbeddingThemeOverrides: false,
  /** Optional: POST archive index snapshot after local index changes */
  usePushArchiveIndex: false,
  /** Siya / chat: call real generative endpoint instead of canned text */
  useGenerativeChatApi: false,
  /**
   * Vision / OCR — run after image save; text is merged into search via `searchableTextById`.
   * Leave false until you have a backend or native pipeline (on-device OCR in Expo usually needs a dev client + native module, or a cloud Vision API).
   */
  useVisionTextExtraction: false,
} as const;

export type ArchiveIdRef = { id: string; fileName: string };

/**
 * TODO: Medhya — query Supabase (or REST) for tags / labels keyed by `id` or storage path.
 * Return only fields you have; empty object = keep local filename-only tags.
 */
export async function placeholder_fetchRemoteArchiveMeta(
  _items: ArchiveIdRef[]
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
  _items: ArchiveIdRef[]
): Promise<Record<string, string>> {
  if (!PLACEHOLDER_FLAGS.useEmbeddingThemeOverrides) return {};
  return {};
}

/**
 * TODO: Medhya — `payload` matches `archiveIndexForBackend` rows; fire-and-forget is fine.
 */
export async function placeholder_notifyArchiveIndexUpdated(_payload: unknown): Promise<void> {
  if (!PLACEHOLDER_FLAGS.usePushArchiveIndex) return;
}

/**
 * TODO: Siya — replace with fetch to your chat / completions route (body + user id + context).
 * For now returns canned copy so the Action UI can be exercised without a server.
 */
export async function placeholder_sendChatMessage(userText: string): Promise<string> {
  if (!PLACEHOLDER_FLAGS.useGenerativeChatApi) {
    return `[Placeholder] Echo: ${userText.trim() || "(empty)"}\n\nWire useGenerativeChatApi + your API in lib/teamIntegrationPlaceholders.ts.`;
  }
  return userText;
}

export type VisionExtractContext = {
  id: string;
  fileName: string;
};

/**
 * TODO: Aaron / backend — OCR + optional scene / object labels from `localFileUri` (file://).
 * Return plain text only; it is folded into the same search index as filenames and tags.
 *
 * Practical options later:
 * - Server: send image to Vision API, GPT-4o/mini vision, or your embedding+caption service.
 * - Native (non–managed Expo): Apple Vision, ML Kit, etc. via config plugin / dev client.
 *
 * When `useVisionTextExtraction` is false, returns "" (no work, no cost).
 */
export async function placeholder_extractSearchableTextFromImage(
  _localFileUri: string,
  _ctx: VisionExtractContext
): Promise<string> {
  if (!PLACEHOLDER_FLAGS.useVisionTextExtraction) return "";
  return "";
}
