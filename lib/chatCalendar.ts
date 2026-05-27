/**
 * Bridges chat replies to a native, editable calendar draft.
 *
 *  - looksSchedulable: cheap heuristic to decide whether to spend an LLM call on extraction
 *  - extractEventDraft: OpenAI JSON call that resolves time / title / location
 *  - openEventInCalendar: opens the OS calendar event editor with the draft pre-filled
 *
 * All entry points are fail-soft: if anything goes wrong, callers get null / "error"
 * so the chat UI just hides the calendar button rather than crashing the message bubble.
 */

const EXTRACT_MODEL = "gpt-4.1-mini";
const EXTRACT_MAX_TOKENS = 220;

export type EventDraft = {
  title: string;
  /** Local ISO 8601, e.g. 2026-05-28T19:00. */
  startIso: string;
  durationMinutes: number;
  location?: string;
  notes?: string;
};

export type OpenInCalendarOutcome = "saved" | "canceled" | "deleted" | "done" | "error";

const SCHEDULABLE_PATTERNS: RegExp[] = [
  /\b(schedule|book|reserve|reschedul\w*|set up|add (?:to )?(?:my )?calendar|calendar invite|invite)\b/i,
  /\b(remind me|put .* on (?:my )?calendar|plan(?:ning)? (?:to|on)|let'?s do|let'?s meet|meeting|appointment|appt|rsvp)\b/i,
  /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/,
  /\b(today|tonight|tomorrow|this (?:weekend|week|morning|afternoon|evening|saturday|sunday|monday|tuesday|wednesday|thursday|friday))\b/i,
  /\b(next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
];

export function looksSchedulable(userText: string, assistantText: string): boolean {
  const blob = `${userText}\n${assistantText}`.toLowerCase();
  if (!blob.trim()) return false;
  return SCHEDULABLE_PATTERNS.some((re) => re.test(blob));
}

function safeTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function clampDuration(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 60;
  return Math.min(240, Math.max(15, Math.round(n)));
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseDraft(raw: unknown): EventDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.event == null && obj.title == null) return null;
  const source = (obj.event && typeof obj.event === "object" ? obj.event : obj) as Record<
    string,
    unknown
  >;

  const title = nonEmptyString(source.title);
  const startIso = nonEmptyString(source.start_iso) ?? nonEmptyString(source.startIso);
  if (!title || !startIso) return null;
  if (Number.isNaN(Date.parse(startIso))) return null;

  const duration = clampDuration(source.duration_minutes ?? source.durationMinutes);
  const location = nonEmptyString(source.location);
  const notes = nonEmptyString(source.notes);

  return {
    title,
    startIso,
    durationMinutes: duration,
    ...(location ? { location } : {}),
    ...(notes ? { notes } : {}),
  };
}

export async function extractEventDraft(
  userText: string,
  assistantText: string
): Promise<EventDraft | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const now = new Date();
  const tz = safeTimezone();
  const nowIso = now.toISOString();
  const nowLocal = now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });

  const system =
    "You turn a short exchange between a user and a planning assistant into ONE actionable calendar event, " +
    "or null if there is no concrete event to schedule. Pick a specific, editable time that makes sense " +
    "(the user can change it). Prefer details the assistant or user mentioned; otherwise use reasonable defaults " +
    "like tomorrow 6pm or this Saturday 10am.\n\n" +
    "Return STRICT JSON only, matching this shape:\n" +
    `{"event": {"title": string, "start_iso": ISO 8601 local time (e.g. 2026-05-28T19:00), ` +
    `"duration_minutes": integer between 15 and 240, "location"?: string, "notes"?: string}}\n` +
    `If there is nothing to schedule, return {"event": null}.`;

  const user =
    `Now (user's local time): ${nowLocal} (${tz}); UTC: ${nowIso}.\n\n` +
    `User said:\n"""${userText.slice(0, 1200)}"""\n\n` +
    `Assistant said:\n"""${assistantText.slice(0, 2000)}"""`;

  const body = {
    model: EXTRACT_MODEL,
    temperature: 0.2,
    max_tokens: EXTRACT_MAX_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let json: { choices?: { message?: { content?: string } }[] };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return null;
  }
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  return parseDraft(parsed);
}

/**
 * Opens the native calendar's event editor with the draft fields pre-filled.
 * On iOS the user sees EKEventEditViewController; on Android the calendar app
 * opens via intent. Either way the user picks the final calendar / invitees.
 */
export async function openEventInCalendar(draft: EventDraft): Promise<OpenInCalendarOutcome> {
  try {
    const Calendar = await import("expo-calendar");
    const start = new Date(draft.startIso);
    if (Number.isNaN(start.getTime())) return "error";
    const end = new Date(start.getTime() + draft.durationMinutes * 60_000);

    const result = await Calendar.createEventInCalendarAsync({
      title: draft.title,
      startDate: start,
      endDate: end,
      ...(draft.location ? { location: draft.location } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
    });

    const action = result?.action;
    if (action === "saved" || action === "canceled" || action === "deleted" || action === "done") {
      return action;
    }
    return "done";
  } catch {
    return "error";
  }
}
