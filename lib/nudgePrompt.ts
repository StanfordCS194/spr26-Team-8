/** Strip recap emphasis markers so routing / chat prompts stay readable. */
export function sanitizeNudgeText(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\\\*/g, "").replace(/\s+/g, " ").trim();
}

/** Internal-only handoff payload (shown to the LLM only; inbox opens Action silently). */
export function buildTentativePlanPrompt(nudgePlain: string): string {
  const n = sanitizeNudgeText(nudgePlain);
  return [
    "Write the user-visible reply per the inbox style in system instructions.",
    "Anticipate friction (time, cost, weather, booking, transport) and bake in quick wins.",
    `Intent card they tapped:\n"${n}"`,
  ].join("\n");
}
