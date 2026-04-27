/**
 * Embedding-based theme/cluster overrides per archive item. Stub today — when wired,
 * returns a deterministic theme label per id from embeddings + policy. Empty object =
 * fall back to local keyword-based `inferTheme` in archiveSearchAndCluster.
 */

import type { ArchiveIdRef } from "@/lib/archiveSearchAndCluster";

const USE_EMBEDDING_THEME_OVERRIDES = false;

export async function fetchEmbeddingThemeOverrides(
  _items: ArchiveIdRef[],
): Promise<Record<string, string>> {
  if (!USE_EMBEDDING_THEME_OVERRIDES) return {};
  return {};
}
