/** Optional prefix from weekly recap: `[memory:<uuid>] …` (stripped in UI). */
const MEMORY_TAG_RE =
  /^\[memory:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*/i;

/** Prefix for onboarding / meta lines (never sent to chat as a prompt). */
const TIP_TAG_RE = /^\[tip\]\s*/i;

export type ParsedNudgeBullet = {
  memoryId: string | null;
  /** Model included `[tip]` — Library / onboarding guidance, not a user task. */
  taggedMetaTip: boolean;
  /** Text shown in the inbox (no `[memory:…]` / `[tip]` prefix). */
  displayLine: string;
};

/** True when content matches the recap’s thin-context onboarding line — no chat query. */
function heuristicMetaUploadTip(displayLine: string): boolean {
  const t = displayLine.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (t.includes("capture your plans") || t.includes("capture your plan clearly")) return true;
  const hasWant =
    t.includes("i want to") ||
    t.includes('"i want to') ||
    t.includes("'i want to") ||
    t.includes("“i want to");
  const hasNext = t.includes("next time");
  const aboutCapture =
    /\bnotes?\b/.test(t) || t.includes("capture") || t.includes("library") || t.includes("upload");
  return hasWant && hasNext && aboutCapture;
}

/** What happens when the user taps an inbox nudge. */
export function resolveNudgeTapAction(parsed: ParsedNudgeBullet): "none" | "library" | "chat" {
  const meta = parsed.taggedMetaTip || heuristicMetaUploadTip(parsed.displayLine);
  if (meta) return "none";
  if (parsed.memoryId) return "library";
  return "chat";
}

function stripListMarker(line: string): string {
  return line
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim();
}

/** Parse one recap line (with or without leading `- `) into display text + optional source memory. */
export function parseNudgeBulletLine(rawLine: string): ParsedNudgeBullet {
  let rest = stripListMarker(rawLine);
  let memoryId: string | null = null;
  const mem = rest.match(MEMORY_TAG_RE);
  if (mem) {
    memoryId = mem[1];
    rest = rest.slice(mem[0].length).trim();
  }
  let taggedMetaTip = false;
  const tip = rest.match(TIP_TAG_RE);
  if (tip) {
    taggedMetaTip = true;
    rest = rest.slice(tip[0].length).trim();
  }
  return { memoryId, taggedMetaTip, displayLine: rest };
}

export function parseWeeklyRecapBullets(raw: string): ParsedNudgeBullet[] {
  return raw
    .split(/\n/)
    .map((line) => parseNudgeBulletLine(line))
    .filter((p) => p.displayLine.length > 0);
}
