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

function buildUserMessage(
  memoryContext: string,
  userText: string,
  imageBase64s: string[]
) {
  const trimmed = userText.trim();
  const textBlock =
    `Memory snippets:\n${memoryContext}\n\n` +
    `User request: ${trimmed || "(image attached, no text)"}`;
  if (imageBase64s.length === 0) {
    return { role: "user" as const, content: textBlock };
  }
  return {
    role: "user" as const,
    content: [
      { type: "text" as const, text: textBlock },
      ...imageBase64s.map((b64) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      })),
    ],
  };
}

/** Suggested prompts for the Action tab until API-driven suggestions exist. */
export const CHAT_PROMPTS = [
  "Create a bucket list for this weekend",
  "Draft a short weekend itinerary",
] as const;

export type ChatResponseStyle = "default" | "inbox_action_plan";

export async function sendChatMessage(
  userText: string,
  options?: { style?: ChatResponseStyle; imageBase64s?: string[] }
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
    "Use the numbered memory snippets as grounding. Snippets prefixed `[Uploaded locally: <time> · <date>]` are in the user's local timezone, newest first — answer time questions using those labels verbatim. If snippets are sparse, give practical defaults briefly.";

  const systemPromptDefault =
    "You are Venn, a planning assistant. Reply like a friend texting — short and warm.\n" +
    memoryDiscipline +
    "\n\nDefault: 1–2 sentences, ≤25 words. For 2 sentences, split into 2 bubbles separated by a blank line. No upsell, no follow-up offers.\n\n" +
    "For lists, itineraries, plans, or 3+ distinct items, use this format:\n" +
    "  one framing sentence\n\n" +
    "  N. **Title** — short body\n" +
    "3–4 items, real named things only.";

  const systemPromptInboxPlan =
    "You're replying to someone who tapped an inbox nudge. Do the thinking legwork — infer the likely next moves.\n" +
    memoryDiscipline +
    "\n\nWarm friend tone, no AI disclaimers. If you don't know live facts, suggest a search phrase instead of inventing URLs.\n\n" +
    "Length: ~30–50 words, hard cap 480 chars. Format:\n" +
    "  reactive opener (1–2 short lines)\n" +
    "  • verb-led bullet\n" +
    "  • verb-led bullet\n" +
    "  • verb-led bullet\n" +
    "  Today: one concrete starter (≤18 words)";

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
      temperature: style === "inbox_action_plan" ? 0.58 : 0.5,
      messages: [
        { role: "system", content: systemPrompt },
        buildUserMessage(memoryContext, userText, options?.imageBase64s ?? []),
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
