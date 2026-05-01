import { supabase } from "@/lib/supabase";

/**
 * Persist chat for weekly recap extraction. Errors are swallowed so chat still works if
 * `chat_messages` is missing or RLS blocks (e.g. migration not applied yet).
 */

export async function logChatMessage(
  userId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  try {
    const { error } = await supabase.from("chat_messages").insert({
      user_id: userId,
      role,
      content: trimmed.slice(0, 8000),
    });
    if (error && __DEV__) {
      console.warn("[chatLog] insert failed:", error.message);
    }
  } catch (e) {
    if (__DEV__) console.warn("[chatLog]", e);
  }
}
