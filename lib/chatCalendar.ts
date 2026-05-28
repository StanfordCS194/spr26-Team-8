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
const EXTRACT_MAX_TOKENS = 260;
/** Tail of recent turns fed into extraction. Keeps prompt cheap but resolves "schedule it" → earlier "Saturday". */
const HISTORY_TURN_LIMIT = 10;
/** Per-turn truncation so a single long reply can't blow the prompt. */
const HISTORY_PER_TURN_CHARS = 600;

export type ChatTurn = { role: "user" | "assistant"; text: string };

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
  /\b(great,? (?:let'?s|please) ?(?:schedule|book|do|plan)|sounds good,? schedule|do it|go ahead and (?:schedule|book|plan))\b/i,
];

/**
 * Cheap pre-filter so we only burn an LLM call when the recent conversation looks event-like.
 * Accepts the tail of the conversation (latest at the end) so phrases like "great, schedule it"
 * still trigger even when the earlier turn was the one with the date.
 */
export function looksSchedulable(turns: ChatTurn[]): boolean {
  if (!turns.length) return false;
  const blob = turns
    .slice(-HISTORY_TURN_LIMIT)
    .map((t) => t.text)
    .join("\n")
    .toLowerCase();
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

function formatHistory(turns: ChatTurn[]): string {
  const tail = turns.slice(-HISTORY_TURN_LIMIT);
  return tail
    .map((t) => {
      const label = t.role === "user" ? "USER" : "ASSISTANT";
      const body = t.text.replace(/\s+/g, " ").trim().slice(0, HISTORY_PER_TURN_CHARS);
      return `${label}: ${body}`;
    })
    .join("\n");
}

export async function extractEventDraft(turns: ChatTurn[]): Promise<EventDraft | null> {
  if (!turns.length) return null;
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const now = new Date();
  const tz = safeTimezone();
  const nowIso = now.toISOString();
  const nowLocal = now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });

  const system =
    "You turn a recent chat conversation between a user and a planning assistant into ONE actionable " +
    "calendar event, or null if there is nothing concrete to schedule. The result will pre-fill an " +
    "editable native calendar draft; the user can adjust before saving.\n\n" +
    "Rules:\n" +
    " - Resolve relative date references across the whole conversation, not just the last turn. " +
    "If the user said \"Saturday\" earlier and \"great, schedule it\" later, use that Saturday.\n" +
    " - When no time-of-day is given, pick a sensible default for the activity:\n" +
    "     hike / outdoor / nature / beach: weekend morning ~8\u201310am, duration 90\u2013120 min\n" +
    "     brunch: weekend 10\u201311am, 75 min\n" +
    "     lunch: weekday 12\u20131pm, 60 min\n" +
    "     dinner / drinks: 6:30\u20138pm, 90 min\n" +
    "     coffee / quick catch-up: weekday morning 9\u201310am or 3\u20134pm, 30\u201345 min\n" +
    "     workout / gym / run: weekday 7am or 6pm, 60 min\n" +
    "     doctor / dentist / appointment / meeting / call: weekday business hours 10am or 2pm, 30\u201360 min\n" +
    "     movie / concert / show / event: evening 7\u20138pm, 120 min\n" +
    "     birthday / party / hang / casual plan: weekend afternoon ~1pm, 120 min\n" +
    "     unspecified leisure: upcoming Saturday 10am\n" +
    " - Do NOT schedule outdoor or leisure activities Mon\u2013Fri 9am\u20135pm unless the conversation explicitly says weekday or work hours.\n" +
    " - If a day was named without time (e.g. \"Saturday\"), keep that day, only choose the time.\n" +
    " - Pick the next future occurrence in the user's local timezone.\n" +
    " - location: include only if it appears verbatim in the conversation. notes: 1\u20132 short sentences summarizing the plan, or omit.\n" +
    " - duration_minutes: integer between 15 and 240.\n\n" +
    "Return STRICT JSON only:\n" +
    `{"event": {"title": string, "start_iso": ISO 8601 local time (e.g. 2026-05-28T19:00), ` +
    `"duration_minutes": integer 15\u2013240, "location"?: string, "notes"?: string}}\n` +
    `If there is nothing concrete to schedule, return {"event": null}.`;

  const history = formatHistory(turns);
  const user =
    `Now (user's local time): ${nowLocal} (${tz}); UTC: ${nowIso}.\n\n` +
    `Recent conversation (oldest first):\n${history}`;

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
