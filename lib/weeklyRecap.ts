import { supabase } from "@/lib/supabase";
import { isMissingTableError, isUndefinedColumnError } from "@/lib/supabaseSchema";

import { utcWeekAnchorMonday } from "@/lib/weekAnchor";

export type WeeklyRecapRow = {
  week_anchor: string;
  bullets: string;
  created_at: string;
};

/** Stored recaps are always at most this many lines (UI + model aligned). */
export const WEEKLY_RECAP_LINE_COUNT = 3;

/**
 * Trim model output to at most `maxLines` bullets, normalized to `- line\\n` form.
 */
export function normalizeRecapBullets(raw: string, maxLines = WEEKLY_RECAP_LINE_COUNT): string {
  const lines = raw
    .split(/\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*•]\s*/, "")
        .replace(/^\s*\d+[.)]\s*/, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .slice(0, maxLines);

  if (lines.length === 0) return "";
  return lines.map((b) => `- ${b}`).join("\n");
}

function daysAgoUtcIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export async function fetchWeeklyRecap(
  weekAnchor?: string
): Promise<WeeklyRecapRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const anchor = weekAnchor ?? utcWeekAnchorMonday();
  const { data, error } = await supabase
    .from("weekly_recaps")
    .select("week_anchor, bullets, created_at")
    .eq("user_id", userId)
    .eq("week_anchor", anchor)
    .maybeSingle();

  if (error) {
    if (__DEV__ && !isMissingTableError(error, "weekly_recaps")) {
      console.warn("[weeklyRecap] fetch:", error.message);
    }
    return null;
  }
  return data as WeeklyRecapRow | null;
}

/** Build recap from uploads + chat, store for this UTC week anchor. */
export async function generateWeeklyRecap(): Promise<{ bullets: string; week_anchor: string } | null> {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Missing EXPO_PUBLIC_OPENAI_API_KEY. Add it to your .env and restart Expo."
    );
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to sign in.");

  const weekAnchor = utcWeekAnchorMonday();
  const sinceIso = daysAgoUtcIso(14);

  const chatQ = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(120);

  let chatRows = chatQ.data ?? [];
  if (chatQ.error && isMissingTableError(chatQ.error, "chat_messages")) {
    chatRows = [];
  } else if (chatQ.error) {
    throw new Error(`Could not load chat history: ${chatQ.error.message}`);
  }

  let memQ = await supabase
    .from("memories")
    .select("want_to_do, user_caption, ocr_description, memory_id")
    .eq("user_id", userId)
    .order("memory_id", { ascending: false })
    .limit(80);

  if (memQ.error && isUndefinedColumnError(memQ.error, "want_to_do")) {
    memQ = await supabase
      .from("memories")
      .select("user_caption, ocr_description, memory_id")
      .eq("user_id", userId)
      .order("memory_id", { ascending: false })
      .limit(80);
  }

  if (memQ.error) {
    throw new Error(`Could not load memories: ${memQ.error.message}`);
  }

  const memoryRows = memQ.data ?? [];

  const chatBlock =
    (chatRows ?? [])
      .map(
        (r: { role: string; content: string }) =>
          `${r.role === "user" ? "User" : "Assistant"}: ${String(r.content).slice(0, 500)}`
      )
      .join("\n") || "(no chat in the last ~2 weeks)";

  const uploadsBlock =
    (memoryRows ?? [])
      .map(
        (m: {
          memory_id: string;
          want_to_do?: string | null;
          user_caption?: string | null;
          ocr_description?: string | null;
        }) => {
          const parts = [m.want_to_do, m.user_caption, m.ocr_description]
            .map((x) => (typeof x === "string" ? x.trim() : ""))
            .filter(Boolean);
          const summary = parts.length ? parts.join(" · ").slice(0, 600) : "(no text on this upload yet)";
          return `MEMORY_ID: ${m.memory_id}\nSUMMARY: ${summary}`;
        }
      )
      .join("\n\n") || "(no saved memories yet)";

  const systemPrompt =
    "You write bite-sized weekly nudges for a mobile app called Venn.\n" +
    `Output EXACTLY ${WEEKLY_RECAP_LINE_COUNT} lines — no more, no less. Each line MUST start with '- '.\n` +
    "Tone: warm, concise, lightly playful (one tiny spark of personality — not cheesy, not corporate).\n" +
    "Each line is ONE tight reminder (max ~11 words) of something they implied they want to do, try, book, buy, or revisit — from uploads or chat.\n" +
    "In each line, wrap the concrete object/item of the action in double-asterisks for emphasis (exactly ONE bold span), like: - Book **dentist appointment**.\n" +
    "Do not bold the verb; bold the thing (place/item/task/name). Do not include more than one **bold** span per line.\n" +
    "Use vivid verbs and plain language. No ‘Dear user’, no lecture. No duplicate ideas.\n" +
    "When a nudge is clearly tied to ONE upload in the MEMORY_ID list (especially invites, RSVPs, events, deadlines, tickets, reservations, flights, shipping), put the tag immediately after the dash and a space:\n" +
    "- [memory:<the-uploads-MEMORY_ID-uuid>] RSVP for **wedding invite**\n" +
    "Use ONLY MEMORY_ID values from the upload section — never invent an id. If the idea comes only from chat or matches no single memory, omit [memory:…].\n" +
    "If context is thin, still output 3 lines: short honest guesses from what exists, and keep one line gently nudging them to add “I want to…” on Library uploads next time.\n" +
    "That onboarding line (only that one) MUST use the tag right after '- ': '- [tip] …' so the app does not treat it as a chat task. Do not use [tip] on the other two lines.";

  const userPayload =
    `--- Recent uploads / intents (captions & “want to”) ---\n${uploadsBlock}\n\n` +
    `--- Recent chat (oldest→newest) ---\n${chatBlock.slice(0, 12000)}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.55,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      `OpenAI error ${response.status}: ${errBody.error?.message ?? "unknown"}`
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const rawBullets = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!rawBullets) throw new Error("Empty recap from OpenAI.");

  const bullets = normalizeRecapBullets(rawBullets);
  if (!bullets) throw new Error("Could not parse recap lines.");

  const { error: upsertError } = await supabase.from("weekly_recaps").upsert(
    { user_id: userId, week_anchor: weekAnchor, bullets },
    { onConflict: "user_id,week_anchor" }
  );

  if (upsertError) {
    if (isMissingTableError(upsertError, "weekly_recaps")) {
      throw new Error(
        "Weekly recap tables are missing. Run the SQL in supabase/migrations/*weekly*nudge*.sql in your Supabase project."
      );
    }
    throw upsertError;
  }

  return { bullets, week_anchor: weekAnchor };
}
