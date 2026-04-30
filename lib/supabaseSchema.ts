import type { PostgrestError } from "@supabase/supabase-js";

/** PostgREST / Supabase when a column is not in the DB yet (migration not applied). */
export function isUndefinedColumnError(
  err: PostgrestError | null | undefined,
  column: string
): boolean {
  if (!err?.message) return false;
  const m = err.message.toLowerCase();
  const c = column.toLowerCase();
  return (
    m.includes(c) &&
    (m.includes("does not exist") ||
      m.includes("could not find") ||
      m.includes("schema cache"))
  );
}

/** When a table has not been created yet (migration not applied). */
export function isMissingTableError(
  err: PostgrestError | null | undefined,
  tableHint: string
): boolean {
  if (!err?.message) return false;
  const m = err.message.toLowerCase();
  return m.includes("could not find the table") && m.includes(tableHint.toLowerCase());
}
