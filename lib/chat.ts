/**
 * Generative chat for the Action tab. Sends the user's message to OpenAI seeded with
 * the user's recent OCR memory descriptions as grounding context.
 */

import { supabase } from "@/lib/supabase";
import { logChatMessage } from "@/lib/chatLog";
import { isUndefinedColumnError } from "@/lib/supabaseSchema";

const USE_GENERATIVE_CHAT_API = true;

/** Suggested prompts for the Action tab until API-driven suggestions exist. */
export const CHAT_PROMPTS = [
  "Create a bucket list for this weekend",
  "Draft a short weekend itinerary",
] as const;

export async function sendChatMessage(userText: string): Promise<string> {
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

  let memRes = await supabase
    .from("memories")
    .select("want_to_do, user_caption, ocr_description")
    .eq("user_id", userId)
    .order("memory_id", { ascending: false })
    .limit(80);

  if (memRes.error && isUndefinedColumnError(memRes.error, "want_to_do")) {
    memRes = await supabase
      .from("memories")
      .select("user_caption, ocr_description")
      .eq("user_id", userId)
      .order("memory_id", { ascending: false })
      .limit(80);
  }

  if (memRes.error) {
    throw new Error(`Could not load memory context: ${memRes.error.message}`);
  }

  const memoryRows = memRes.data;

  const snippets = (memoryRows ?? []).map((row) => {
    const parts = [row.want_to_do, row.user_caption, row.ocr_description]
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }).filter((s): s is string => Boolean(s));

  const memoryContext =
    snippets.length > 0
      ? snippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "No memory text yet (captions / “want to” / OCR). Upload or add intents in Library.";

  void logChatMessage(userId, "user", userText);

  const systemPrompt =
    "You are a planning assistant for the user's saved memories.\n" +
    "Ground your answer in ONLY the numbered memory snippets (want-to intentions, captions, OCR).\n" +
    "When asked for a bucket list or itinerary, synthesize actionable ideas.\n" +
    "If context is sparse, say so briefly and suggest they add captions or ‘I want to…’ when uploading.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.7,
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
