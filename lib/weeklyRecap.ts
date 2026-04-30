import { supabase } from "@/lib/supabase";

import { utcWeekAnchorMonday } from "@/lib/weekAnchor";

export type WeeklyRecapRow = {
  week_anchor: string;
  bullets: string;
  created_at: string;
};

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
    if (__DEV__) console.warn("[weeklyRecap] fetch:", error.message);
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

  const [{ data: chatRows }, { data: memoryRows }] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(120),
    supabase
      .from("memories")
      .select("want_to_do, user_caption, ocr_description, memory_id")
      .eq("user_id", userId)
      .order("memory_id", { ascending: false })
      .limit(80),
  ]);

  const chatBlock =
    (chatRows ?? [])
      .map(
        (r: { role: string; content: string }) =>
          `${r.role === "user" ? "User" : "Assistant"}: ${String(r.content).slice(0, 500)}`
      )
      .join("\n") || "(no chat in the last ~2 weeks)";

  const uploadsBlock =
    (memoryRows ?? [])
      .map((m: { want_to_do?: string | null; user_caption?: string | null; ocr_description?: string | null }) => {
        const parts = [m.want_to_do, m.user_caption, m.ocr_description]
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean);
        return parts.length ? `- ${parts.join(" · ").slice(0, 600)}` : null;
      })
      .filter(Boolean)
      .join("\n") || "(no saved memory text yet)";

  const systemPrompt =
    "You distill explicit plans and intents from the user's uploads and chats.\n" +
    "Output 4–7 short bullet lines ONLY. Start each line with '- '. No title, no numbering without '- '.\n" +
    "Each bullet should remind the user of something they said they WANT to DO, TRY, BOOK, BUY, SCHEDULE, or REVISIT.\n" +
    "Prefer concrete wording. Omit generic filler. If evidence is thin, produce a few honest best-effort bullets and add one bullet: '- Add a short “I want to…” when you upload so we can remind you.'";

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
      temperature: 0.4,
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
  const bullets = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!bullets) throw new Error("Empty recap from OpenAI.");

  const { error: upsertError } = await supabase.from("weekly_recaps").upsert(
    { user_id: userId, week_anchor: weekAnchor, bullets },
    { onConflict: "user_id,week_anchor" }
  );

  if (upsertError) throw upsertError;

  return { bullets, week_anchor: weekAnchor };
}
