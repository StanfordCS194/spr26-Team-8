const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `[memory:<uuid>]`, `[memory/<uuid>]`, etc. — stripped from inbox display text. */
const MEMORY_TAG_RE = new RegExp(`\\[memory[:/\\s-]*(${UUID})\\]`, "gi");

/** Model sometimes leaks training labels into the nudge line. */
const MEMORY_ID_LEAK_RE = new RegExp(`\\bMEMORY_ID:\\s*(${UUID})\\b`, "gi");

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

function firstCapture(re: RegExp, text: string): string | null {
  re.lastIndex = 0;
  const m = re.exec(text);
  return m?.[1] ?? null;
}

function stripMemoryArtifacts(text: string): string {
  return text
    .replace(MEMORY_TAG_RE, "")
    .replace(MEMORY_ID_LEAK_RE, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Parse one recap line (with or without leading `- `) into display text + optional source memory. */
export function parseNudgeBulletLine(rawLine: string): ParsedNudgeBullet {
  let rest = stripListMarker(rawLine);
  const memoryId =
    firstCapture(MEMORY_TAG_RE, rest) ?? firstCapture(MEMORY_ID_LEAK_RE, rest);

  let taggedMetaTip = false;
  const tip = rest.match(TIP_TAG_RE);
  if (tip) {
    taggedMetaTip = true;
    rest = rest.slice(tip[0].length).trim();
  }

  rest = stripMemoryArtifacts(rest);

  return { memoryId, taggedMetaTip, displayLine: rest };
}

export function parseWeeklyRecapBullets(raw: string): ParsedNudgeBullet[] {
  return raw
    .split(/\n/)
    .map((line) => parseNudgeBulletLine(line))
    .filter((p) => p.displayLine.length > 0);
}
