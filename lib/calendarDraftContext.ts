import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventDraft, OpenInCalendarOutcome } from "@/lib/chatCalendar";

const CALENDAR_DRAFTS_KEY = "venn_calendar_draft_context_v1";
const MAX_STORED_DRAFTS = 40;

export type CalendarDraftContextRecord = {
  id: string;
  userId: string;
  createdAt: string;
  outcome: OpenInCalendarOutcome;
  draft: EventDraft;
  sourceMessageText: string;
};

function isRecord(value: unknown): value is CalendarDraftContextRecord {
  if (!value || typeof value !== "object") return false;
  const rec = value as CalendarDraftContextRecord;
  return (
    typeof rec.id === "string" &&
    typeof rec.userId === "string" &&
    typeof rec.createdAt === "string" &&
    typeof rec.outcome === "string" &&
    rec.draft != null &&
    typeof rec.draft === "object" &&
    typeof rec.draft.title === "string" &&
    typeof rec.draft.startIso === "string" &&
    typeof rec.draft.durationMinutes === "number" &&
    typeof rec.sourceMessageText === "string"
  );
}

async function loadAllCalendarDraftContext(): Promise<CalendarDraftContextRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(CALENDAR_DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

export async function saveCalendarDraftContext(params: {
  userId: string;
  draft: EventDraft;
  outcome: OpenInCalendarOutcome;
  sourceMessageText: string;
}): Promise<void> {
  if (!params.userId || params.outcome === "error") return;
  const existing = await loadAllCalendarDraftContext();
  const record: CalendarDraftContextRecord = {
    id: `calendar-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    createdAt: new Date().toISOString(),
    outcome: params.outcome,
    draft: params.draft,
    sourceMessageText: params.sourceMessageText.trim().slice(0, 1200),
  };
  const sameUser = [record, ...existing.filter((r) => r.userId === params.userId)].slice(
    0,
    MAX_STORED_DRAFTS
  );
  const next = [...sameUser, ...existing.filter((r) => r.userId !== params.userId)].slice(
    0,
    MAX_STORED_DRAFTS * 3
  );
  try {
    await AsyncStorage.setItem(CALENDAR_DRAFTS_KEY, JSON.stringify(next));
  } catch {
    // Calendar context should never block chat/calendar UX.
  }
}

export async function loadRecentCalendarDraftContext(
  userId: string,
  limit = 5
): Promise<CalendarDraftContextRecord[]> {
  if (!userId) return [];
  const all = await loadAllCalendarDraftContext();
  return all
    .filter((r) => r.userId === userId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}
