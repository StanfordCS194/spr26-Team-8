/**
 * Generative chat for the Action tab. Sends the user's message to OpenAI seeded with
 * the user's recent OCR memory descriptions as grounding context.
 */

import { supabase } from "@/lib/supabase";
import { logChatMessage } from "@/lib/chatLog";

const USE_GENERATIVE_CHAT_API = true;

type MemoryChatRow = {
  memory_id?: string;
  want_to_do?: string | null;
  user_caption?: string | null;
  ocr_description?: string | null;
  /** Server row time when the column exists in Supabase */
  created_at?: string | null;
  /** Client-written JSON from Library upload — includes generated_at (~upload flow time) */
  text_temporal?: unknown;
};

function coerceTextTemporal(
  raw: unknown
): { generated_at?: string; ref_local_iso?: string } | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s) as unknown;
      return parsed && typeof parsed === "object"
        ? (parsed as { generated_at?: string; ref_local_iso?: string })
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as { generated_at?: string; ref_local_iso?: string };
  }
  return null;
}

function uploadIsoFromRow(row: MemoryChatRow): string | null {
  const ca =
    typeof row.created_at === "string" && row.created_at.trim() ? row.created_at.trim() : null;
  const tt = coerceTextTemporal(row.text_temporal);
  const ga =
    typeof tt?.generated_at === "string" && tt.generated_at.trim() ? tt.generated_at.trim() : null;
  const ref =
    typeof tt?.ref_local_iso === "string" && tt.ref_local_iso.trim() ? tt.ref_local_iso.trim() : null;
  const fromJson = ga ?? ref;
  return ca ?? fromJson ?? null;
}

/** Device-local wording so “what time?” questions mirror the clock the user sees. */
function uploadLabelForSnippet(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return `time unknown (${iso})`;
  const d = new Date(ms);
  const clock = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `[Uploaded locally: ${clock} · ${day}] `;
}

function uploadSortMs(row: MemoryChatRow): number | null {
  const iso = uploadIsoFromRow(row);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

async function loadMemoriesForChatContext(userId: string): Promise<MemoryChatRow[]> {
  /** Try richest select first; back off columns missing on older schemas. */
  const attempts = [
    "want_to_do, user_caption, ocr_description, memory_id, text_temporal, created_at",
    "want_to_do, user_caption, ocr_description, memory_id, text_temporal",
    "want_to_do, user_caption, ocr_description, memory_id, created_at",
    "want_to_do, user_caption, ocr_description, memory_id",
    "user_caption, ocr_description, memory_id, text_temporal, created_at",
    "user_caption, ocr_description, memory_id, text_temporal",
    "user_caption, ocr_description, memory_id, created_at",
    "user_caption, ocr_description, memory_id",
  ] as const;

  let lastMessage = "";
  for (const sel of attempts) {
    const memRes = await supabase
      .from("memories")
      .select(sel)
      .eq("user_id", userId)
      .order("memory_id", { ascending: false })
      .limit(80);
    if (!memRes.error) return ((memRes.data ?? []) as MemoryChatRow[]) ?? [];
    lastMessage = memRes.error.message;
  }

  throw new Error(`Could not load memory context: ${lastMessage}`);
}

/** Suggested prompts for the Action tab until API-driven suggestions exist. */
export const CHAT_PROMPTS = [
  "Create a bucket list for this weekend",
  "Draft a short weekend itinerary",
] as const;

export type ChatResponseStyle = "default" | "inbox_action_plan";

export async function sendChatMessage(
  userText: string,
  options?: { style?: ChatResponseStyle }
): Promise<string> {
  if (!USE_GENERATIVE_CHAT_API) {
    return `Echo: ${userText.trim() || "(empty)"}`;
  }
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_OPENAI_API_KEY. Add it to your .env and restart Expo."
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) {
    throw new Error("You need to sign in before using chat.");
  }

  let memoryRows: MemoryChatRow[];
  try {
    memoryRows = await loadMemoriesForChatContext(userId);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Could not load memory context.");
  }

  const sortedRows = [...memoryRows].sort((a, b) => {
    const tb = uploadSortMs(b);
    const ta = uploadSortMs(a);
    if (tb !== null && ta !== null) return tb - ta;
    if (tb !== null) return 1;
    if (ta !== null) return -1;
    const mb = String(b.memory_id ?? "");
    const ma = String(a.memory_id ?? "");
    return mb.localeCompare(ma);
  });

  const snippets = sortedRows.map((row) => {
    const parts = [row.want_to_do, row.user_caption, row.ocr_description]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    const body = parts.length ? parts.join(" · ") : "";
    const iso = uploadIsoFromRow(row);
    const prefix = iso ? uploadLabelForSnippet(iso) : "";

    // Keep rows visible for “when did I upload?” even before OCR fills in.
    if (!body.trim() && iso) return `${prefix}(no caption / OCR text yet)`.trim();

    if (!body.trim()) return null;
    return `${prefix}${body}`.trim();
  }).filter((s): s is string => Boolean(s));

  const memoryContext =
    snippets.length > 0
      ? snippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "No memory snippets yet — nothing with caption, OCR, or upload timestamps. Add something from Library.";

  void logChatMessage(userId, "user", userText);

  const style = options?.style ?? "default";

  const memoryDiscipline =
    "Use the numbered memory snippets (want‑to intentions, captions, OCR) as grounding.\n" +
    "Lines often start with **`[Uploaded locally: <time> · <date>]`** — that is **the user’s phone clock timezone** when the save happened (prefer server `created_at` when listed; otherwise it comes from upload metadata).\n" +
    "Snippet **#1 is the newest** whenever those upload labels exist.\n" +
    "Answer “what time?” / “most recent?” using **that labeled local time/date** verbatim when present — don’t say timestamps are unavailable.\n" +
    "Prefer concrete, real‑world actions. If snippets are sparse, say so briefly and still give practical defaults.";

  const systemPromptDefault =
    "You are a planning assistant embedded in Venn.\n" +
    memoryDiscipline +
    "\nWhen asked for a bucket list or itinerary, synthesize actionable ideas.";

  const systemPromptInboxPlan =
    "You’re replying to someone who tapped a tiny inbox nudge — they want you to do the thinking legwork.\n" +
    memoryDiscipline +
    "\n\nVoice: talk like a warm, slightly informal friend (use “you”, light contractions). " +
    "No corporate tone, no “Happy to help!”, no AI disclaimer.\n\n" +
    "Do the “research” for them in a honest way: infer the likely next moves (what to check, book, pack, message, budget for). " +
    "When their memories name places/dates/gear, use them. " +
    "If you don’t know live facts, don’t fake them — give 1–2 tight search phrases they can paste into Google/Maps " +
    "(e.g. “Seljalandsfoss trail conditions May”) or name the *type* of site to check (park page, official hours, trail app). " +
    "Never invent URLs.\n\n" +
    "Length: roughly **280–420 characters** (~40–62 words); hard ceiling **520 characters**. Tight beats thorough.\n\n" +
    "Format (conversation-shaped, easy to skim):\n" +
    "- Line 1–2: reactive + the gist (“Yeah—if you’re doing X, I'd…”).\n" +
    "- Then **3 bullets** (`• …`) each fragment-length (start with a verb).\n" +
    "- Final line starts with Today: … (single concrete starter, ≤18 words).\n" +
    "- If something essential is missing: add one tiny line: Small ask — … (?)\n\n" +
    "Do NOT echo the invisible instruction/metadata block; only reply as the assistant.";

  const systemPrompt =
    style === "inbox_action_plan" ? systemPromptInboxPlan : systemPromptDefault;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: style === "inbox_action_plan" ? 0.58 : 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `Memory snippets:\n${memoryContext}\n\n` +
            `User request: ${userText.trim()}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      `OpenAI chat error ${response.status}: ${errBody.error?.message ?? "unknown error"}`
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  void logChatMessage(userId, "assistant", content);

  return content;
}
