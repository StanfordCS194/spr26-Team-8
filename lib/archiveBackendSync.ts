/**
 * Network sync for archive metadata. Stubs today:
 *   - fetchRemoteArchiveMeta    — pull tags / labels from Supabase by id
 *   - notifyArchiveIndexUpdated — fire-and-forget POST of the local index snapshot
 */

import type { ArchiveIdRef, ArchiveItemMeta } from "@/lib/archiveSearchAndCluster";

const USE_REMOTE_ARCHIVE_META = false;
const USE_PUSH_ARCHIVE_INDEX = false;

export async function fetchRemoteArchiveMeta(
  _items: ArchiveIdRef[],
): Promise<Record<string, Partial<ArchiveItemMeta>>> {
  if (!USE_REMOTE_ARCHIVE_META) return {};
  // Example future shape:
  // return { "uploaded-123.jpg": { tags: ["restaurant", "nyc"] } };
  return {};
}

export async function notifyArchiveIndexUpdated(
  _payload: unknown,
): Promise<void> {
  if (!USE_PUSH_ARCHIVE_INDEX) return;
}
