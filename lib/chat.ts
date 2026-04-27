/**
 * Generative chat for the Action tab. Sends the user's message to OpenAI seeded with
 * the user's recent OCR memory descriptions as grounding context.
 */

import { supabase } from "@/lib/supabase";

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

  const { data: memoryRows, error: memoryError } = await supabase
    .from("memories")
    .select("ocr_description")
    .eq("user_id", userId)
    .not("ocr_description", "is", null)
    .order("memory_id", { ascending: false })
    .limit(80);

  if (memoryError) {
    throw new Error(`Could not load memory context: ${memoryError.message}`);
  }

  const descriptions = (memoryRows ?? [])
    .map((row) => row.ocr_description?.trim())
    .filter((text): text is string => Boolean(text));

  const memoryContext =
    descriptions.length > 0
      ? descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")
      : "No OCR descriptions are available yet.";

  const systemPrompt =
    "You are a planning assistant for the user's saved memories.\n" +
    "Use ONLY the provided OCR memory descriptions as grounding context.\n" +
    "When asked for a bucket list or itinerary, synthesize ideas from those memories.\n" +
    "If context is sparse, say so and provide a best-effort draft.";

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
            `OCR memory descriptions:\n${memoryContext}\n\n` +
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

  return content;
}
