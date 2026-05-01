/**
 * Phase 1: extract time-oriented signals from caption + want_to_do only (no image OCR yet).
 * Output is intentionally conservative: spans + coarse interpretations + ISO guesses when parsing succeeds.
 */

export const TEXT_TEMPORAL_SCHEMA_VERSION = 1 as const;

export type TemporalTextSource = "caption" | "want_to_do";

export type TemporalSpanCategory =
  | "absolute_date"
  | "relative"
  | "time_of_day"
  | "duration"
  | "calendar_period"
  | "ambiguous";

export type TemporalSpan = {
  snippet: string;
  source: TemporalTextSource;
  category: TemporalSpanCategory;
  /** 0–1 heuristic confidence for this excerpt */
  confidence: number;
};

export type TemporalGrain = "instant" | "day" | "range" | "month" | "fuzzy";

export type TemporalInterpretation = {
  id: string;
  label: string;
  grain: TemporalGrain;
  /** Best-effort local-time ISO bounds (device timezone). Null when unknown */
  estimated_start_iso: string | null;
  estimated_end_iso: string | null;
  confidence: number;
};

export type TextTemporalPayload = {
  schema_version: typeof TEXT_TEMPORAL_SCHEMA_VERSION;
  generated_at: string;
  /** Reference moment used when resolving relative phrases (usually upload time). */
  ref_local_iso: string;
  spans: TemporalSpan[];
  interpretations: TemporalInterpretation[];
};

const MONTH_PATTERN =
  "(?:" +
  [
    "jan(?:uary)?",
    "feb(?:ruary)?",
    "mar(?:ch)?",
    "apr(?:il)?",
    "may",
    "jun(?:e)?",
    "jul(?:y)?",
    "aug(?:ust)?",
    "sep(?:t(?:ember)?)?",
    "oct(?:ober)?",
    "nov(?:ember)?",
    "dec(?:ember)?",
  ].join("|") +
  ")";

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = startOfLocalDay(d);
  x.setDate(x.getDate() + 1);
  x.setMilliseconds(-1);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function nextWeekday(from: Date, targetDow0Sun: number): Date {
  const x = startOfLocalDay(from);
  const cur = x.getDay();
  let delta = (targetDow0Sun - cur + 7) % 7;
  if (delta === 0) delta = 7;
  x.setDate(x.getDate() + delta);
  return x;
}

function parseIsoLike(s: string): Date | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Interprets as US-style MM/DD/YYYY when ambiguous vs DD/MM — conservative. */
function parseSlashDate(match: RegExpExecArray): Date | null {
  const a = Number(match[1]);
  const b = Number(match[2]);
  let y = Number(match[3]);
  if (y < 100) y += 2000;
  if (a < 1 || a > 12 || b < 1 || b > 31) return null;
  const d = new Date(y, a - 1, b);
  return d.getFullYear() === y && d.getMonth() === a - 1 && d.getDate() === b ? d : null;
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function monthIndexFromToken(tok: string): number {
  const t = tok.toLowerCase();
  return MONTH_NAMES.findIndex((m) => m.startsWith(t.slice(0, 3)));
}

/** Small integers spoken as words in “within the next two weeks”–style phrases. */
const WEEK_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Local calendar date for the last day of the month containing `ref`. */
function lastCalendarDayOfMonthLocal(ref: Date): Date {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  return new Date(y, m + 1, 0);
}

/**
 * Week count from colloquial multi-week deadlines (overlap with numeric `in N weeks`
 * intentionally excluded — handled by existing `\bin\s+…` matcher).
 */
function parseMultiWeekDeadlineWeeks(snippet: string): number | null {
  const low = snippet.toLowerCase();
  let m = /\bwithin\s+(?:the\s+)?next\s+(\d+)\s+weeks?\b/i.exec(low);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 52) : null;
  }
  m =
    /\bwithin\s+(?:the\s+)?next\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+weeks?\b/i.exec(
      low
    );
  if (m?.[1] && WEEK_COUNT_WORDS[m[1]]) return WEEK_COUNT_WORDS[m[1]];

  m = /\bnext\s+(\d+)\s+weeks?\b/i.exec(low);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 52) : null;
  }

  m =
    /\bnext\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+weeks?\b/i.exec(low);
  if (m?.[1] && WEEK_COUNT_WORDS[m[1]]) return WEEK_COUNT_WORDS[m[1]];

  return null;
}

function scanRegex(
  text: string,
  source: TemporalTextSource,
  re: RegExp,
  category: TemporalSpanCategory,
  confidence: number,
  out: TemporalSpan[]
) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text)) !== null) {
    const snippet = (m[0] ?? "").trim();
    if (snippet.length < 3 || seen.has(snippet)) continue;
    seen.add(snippet);
    out.push({ snippet, source, category, confidence });
  }
}

function collectSpansFromField(text: string, source: TemporalTextSource): TemporalSpan[] {
  const t = text.trim();
  if (!t) return [];
  const spans: TemporalSpan[] = [];

  scanRegex(t, source, /\b\d{4}-\d{2}-\d{2}(?:[tT ]\d{1,2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:\d{2})?\b/g, "absolute_date", 0.88, spans);
  scanRegex(t, source, /\b\d{4}-\d{2}-\d{2}\b/g, "absolute_date", 0.82, spans);
  scanRegex(t, source, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "absolute_date", 0.55, spans);
  scanRegex(
    t,
    source,
    new RegExp(`\\b\\d{1,2}\\s+${MONTH_PATTERN}\\b(?:\\s+\\d{2,4})?`, "gi"),
    "absolute_date",
    0.72,
    spans
  );
  scanRegex(
    t,
    source,
    new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}\\b(?:\\s*,\\s*\\d{2,4})?`, "gi"),
    "absolute_date",
    0.72,
    spans
  );

  const relRes = /\b(?:today|tonight|tomorrow)\b/gi;
  scanRegex(t, source, relRes, "relative", 0.75, spans);
  scanRegex(t, source, /\b(?:next|this)\s+(?:week|month|year)\b/gi, "calendar_period", 0.6, spans);
  scanRegex(
    t,
    source,
    /\b(?:next|this)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    "relative",
    0.68,
    spans
  );
  scanRegex(t, source, /\bin\s+\d+\s+(?:day|days|week|weeks|month|months)\b/gi, "duration", 0.55, spans);
  scanRegex(
    t,
    source,
    /\bwithin\s+(?:the\s+)?next\s+\d+\s+weeks?\b/gi,
    "duration",
    0.62,
    spans
  );
  scanRegex(
    t,
    source,
    new RegExp(
      `\\bwithin\\s+(?:the\\s+)?next\\s+(?:${Object.keys(WEEK_COUNT_WORDS).join("|")})\\s+weeks?\\b`,
      "gi"
    ),
    "duration",
    0.61,
    spans
  );
  scanRegex(t, source, /\bnext\s+\d+\s+weeks?\b/gi, "duration", 0.6, spans);
  scanRegex(
    t,
    source,
    new RegExp(
      `\\bnext\\s+(?:${Object.keys(WEEK_COUNT_WORDS).join("|")})\\s+weeks?\\b`,
      "gi"
    ),
    "duration",
    0.58,
    spans
  );
  scanRegex(
    t,
    source,
    /\bby\s+(?:the\s+)?end\s+of\s+(?:the\s+)?month\b/gi,
    "calendar_period",
    0.56,
    spans
  );
  scanRegex(t, source, /\b(?:morning|afternoon|evening|night)\b/gi, "time_of_day", 0.4, spans);
  scanRegex(t, source, /\b(?:spring|summer|fall|autumn|winter)\s+\d{4}\b/gi, "calendar_period", 0.45, spans);

  spans.sort((a, b) => b.confidence - a.confidence);

  const dedup: TemporalSpan[] = [];
  for (const s of spans) {
    if (!dedup.some((x) => x.snippet.toLowerCase() === s.snippet.toLowerCase() && x.source === s.source))
      dedup.push(s);
  }
  return dedup;
}

function interpretationsFromSpans(spans: TemporalSpan[], ref: Date): TemporalInterpretation[] {
  const out: TemporalInterpretation[] = [];
  let id = 0;
  const nextId = () => `i${++id}`;

  for (const s of spans) {
    const low = s.snippet.toLowerCase();

    if (s.category === "relative") {
      if (/\btoday\b/.test(low)) {
        const st = startOfLocalDay(ref);
        const en = endOfLocalDay(ref);
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "day",
          estimated_start_iso: st.toISOString(),
          estimated_end_iso: en.toISOString(),
          confidence: s.confidence * 0.9,
        });
      }
      if (/\btonight\b/.test(low)) {
        const st = new Date(ref);
        st.setHours(18, 0, 0, 0);
        const en = endOfLocalDay(ref);
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "range",
          estimated_start_iso: st.toISOString(),
          estimated_end_iso: en.toISOString(),
          confidence: s.confidence * 0.55,
        });
      }
      if (/\btomorrow\b/.test(low)) {
        const d = startOfLocalDay(addDays(ref, 1));
        const st = d;
        const en = endOfLocalDay(d);
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "day",
          estimated_start_iso: st.toISOString(),
          estimated_end_iso: en.toISOString(),
          confidence: s.confidence * 0.85,
        });
      }

      const wdMatch = /\b(?:next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
        s.snippet
      );
      if (wdMatch) {
        const name = wdMatch[1].toLowerCase();
        const dowMap: Record<string, number> = {
          sunday: 0,
          monday: 1,
          tuesday: 2,
          wednesday: 3,
          thursday: 4,
          friday: 5,
          saturday: 6,
        };
        const dow = dowMap[name] ?? 1;
        const isNext = /\bnext\b/i.test(s.snippet);
        let day: Date;
        if (isNext) {
          day = nextWeekday(ref, dow);
        } else {
          const sod = startOfLocalDay(ref);
          const cur = sod.getDay();
          let add = (dow - cur + 7) % 7;
          if (add < 0) add += 7;
          day = startOfLocalDay(addDays(sod, add));
        }
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "day",
          estimated_start_iso: startOfLocalDay(day).toISOString(),
          estimated_end_iso: endOfLocalDay(day).toISOString(),
          confidence: s.confidence * (isNext ? 0.7 : 0.55),
        });
      }
    }

    if (s.category === "absolute_date") {
      let d: Date | null = parseIsoLike(s.snippet.replace(/\.$/, ""));
      const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.snippet.trim());
      if (!d && slash) d = parseSlashDate(slash);
      const dm = /^(\d{1,2})\s+(\w+)(?:\s+(\d{2,4}))?\s*$/.exec(s.snippet.trim().replace(/,/g, ""));
      if (!d && dm) {
        const dayNum = Number(dm[1]);
        const mx = monthIndexFromToken(dm[2] ?? "");
        const yr = dm[3] ? Number(dm[3]) : ref.getFullYear();
        if (mx >= 0 && dayNum >= 1 && dayNum <= 31) {
          let cand = new Date(yr, mx, dayNum);
          if (!dm[3] && cand < startOfLocalDay(ref)) {
            cand = new Date(ref.getFullYear() + 1, mx, dayNum);
          }
          d = cand.getMonth() === mx && cand.getDate() === dayNum ? cand : null;
        }
      }
      const monthDay2 = /^(\w+)\s+(\d{1,2})(?:\s*,?\s*(\d{2,4}))?$/i.exec(s.snippet.trim().replace(/,/g, ""));
      if (!d && monthDay2) {
        const [, monStr, dd, yr] = monthDay2;
        const monthIdx = monthIndexFromToken(monStr ?? "");
        const dayNum = Number(dd);
        const yearNum = yr ? Number(yr) : ref.getFullYear();
        if (monthIdx >= 0 && dayNum >= 1 && dayNum <= 31) {
          let cand = new Date(yearNum, monthIdx, dayNum);
          if (!yr && cand < startOfLocalDay(ref)) {
            cand = new Date(ref.getFullYear() + 1, monthIdx, dayNum);
          }
          d = cand.getMonth() === monthIdx && cand.getDate() === dayNum ? cand : null;
        }
      }

      if (d && !Number.isNaN(d.getTime())) {
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "day",
          estimated_start_iso: startOfLocalDay(d).toISOString(),
          estimated_end_iso: endOfLocalDay(d).toISOString(),
          confidence: s.confidence,
        });
      }
    }

    if (s.category === "calendar_period") {
      if (/\bthis\s+week\b/i.test(low) || /\bnext\s+week\b/i.test(low)) {
        const start = /\bnext\s+week\b/i.test(low) ? addDays(startOfLocalDay(ref), 7) : startOfLocalDay(ref);
        const spanStart = startOfLocalDay(start);
        const spanEnd = endOfLocalDay(addDays(spanStart, 6));
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "range",
          estimated_start_iso: spanStart.toISOString(),
          estimated_end_iso: spanEnd.toISOString(),
          confidence: s.confidence * 0.45,
        });
      }
      if (/\bby\s+(?:the\s+)?end\s+of\s+(?:the\s+)?month\b/i.test(low)) {
        const lastDay = lastCalendarDayOfMonthLocal(ref);
        const st = startOfLocalDay(lastDay);
        const en = endOfLocalDay(lastDay);
        out.push({
          id: nextId(),
          label: s.snippet,
          grain: "day",
          estimated_start_iso: st.toISOString(),
          estimated_end_iso: en.toISOString(),
          confidence: s.confidence * 0.52,
        });
      }
    }

    const multiWeeks = parseMultiWeekDeadlineWeeks(s.snippet);
    if (multiWeeks !== null && s.category === "duration") {
      const end = addDays(ref, multiWeeks * 7);
      out.push({
        id: nextId(),
        label: s.snippet,
        grain: "range",
        estimated_start_iso: ref.toISOString(),
        estimated_end_iso: end.toISOString(),
        confidence: s.confidence * 0.52,
      });
    }

    const durIn = /\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i.exec(s.snippet);
    if (durIn && s.category === "duration") {
      const n = Number(durIn[1]);
      const unit = durIn[2].toLowerCase();
      let end = ref;
      if (unit.startsWith("day")) end = addDays(ref, n);
      if (unit.startsWith("week")) end = addDays(ref, n * 7);
      if (unit.startsWith("month")) end = new Date(ref.getFullYear(), ref.getMonth() + n, ref.getDate());
      out.push({
        id: nextId(),
        label: s.snippet,
        grain: "range",
        estimated_start_iso: ref.toISOString(),
        estimated_end_iso: end.toISOString(),
        confidence: s.confidence * 0.5,
      });
    }
  }

  const seen = new Set<string>();
  return out.filter((x) => {
    const key = `${x.estimated_start_iso}|${x.estimated_end_iso}|${x.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Build JSON payload suitable for `memories.text_temporal`. */
export function extractTextTemporalSignals(args: {
  caption: string;
  want_to_do?: string | null;
  /** Reference “now”; defaults to new Date(). Use for deterministic tests */
  referenceDate?: Date;
}): TextTemporalPayload {
  const ref = args.referenceDate ?? new Date();
  const cap = (args.caption ?? "").trim();
  const want = (args.want_to_do ?? "").trim();

  const spans: TemporalSpan[] = [
    ...collectSpansFromField(cap, "caption"),
    ...collectSpansFromField(want, "want_to_do"),
  ];

  const interpretations = interpretationsFromSpans(spans, ref);

  return {
    schema_version: TEXT_TEMPORAL_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    ref_local_iso: ref.toISOString(),
    spans: spans.slice(0, 48),
    interpretations: interpretations.slice(0, 16),
  };
}
