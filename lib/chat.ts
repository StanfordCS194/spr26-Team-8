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

  const style = options?.style ?? "default";

  const memoryDiscipline =
    "Use the numbered memory snippets (want‑to intentions, captions, OCR) as grounding.\n" +
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
