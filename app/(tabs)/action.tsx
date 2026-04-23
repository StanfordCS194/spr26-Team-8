import { PLACEHOLDER_CHAT_PROMPTS } from "@/lib/chatPromptPlaceholders";
import { placeholder_sendChatMessage } from "@/lib/teamIntegrationPlaceholders";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ChatMessage = { role: "user" | "assistant"; text: string };

export default function ActionTab() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "I can help plan from your uploaded memories. Try one of the quick actions below.",
    },
  ]);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const appendExchange = useCallback(async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    try {
      const reply = await placeholder_sendChatMessage(trimmed);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            err instanceof Error
              ? `Sorry, I could not generate a response: ${err.message}`
              : "Sorry, I could not generate a response right now.",
        },
      ]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [sending]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#F4F0EA]"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 bg-[#F4F0EA]">
        <SafeAreaView
          className="flex-1 bg-[#F4F0EA]"
          edges={["top", "left", "right"]}
        >
          <Text className="px-5 pt-2 text-sm font-medium text-[#5F5F5F]">Assistant</Text>
          <Text className="px-5 pt-1 text-4xl font-bold tracking-[-0.5px] text-[#0B0B0B]">Action</Text>
          <Text className="px-5 pb-2 pt-1 text-xs font-medium uppercase tracking-[0.2em] text-[#6B6B6B]">
            Memory-aware assistant
          </Text>

          <ScrollView
            ref={scrollRef}
            className="flex-1 px-5"
            contentContainerClassName="pb-4"
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
          >
            {messages.map((msg, i) => (
              <View
                key={`${i}-${msg.role}`}
                className={`mb-3 max-w-[92%] rounded-3xl px-4 py-3 ${
                  msg.role === "user"
                    ? "self-end bg-[#0B0B0B]"
                    : "self-start border border-[#E6E1DA] bg-white shadow-sm"
                }`}
              >
                <Text
                  className={`text-base leading-6 ${
                    msg.role === "user" ? "text-white" : "text-[#0B0B0B]"
                  }`}
                >
                  {msg.text}
                </Text>
              </View>
            ))}
            {sending ? (
              <View className="flex-row items-center gap-2 py-2">
                <ActivityIndicator size="small" color="#0B0B0B" />
                <Text className="text-sm text-[#5F5F5F]">Working…</Text>
              </View>
            ) : null}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-t border-[#EFE8DF] bg-[#F4F0EA] px-3 pt-2"
            contentContainerClassName="flex-row gap-2 pr-2"
          >
            {PLACEHOLDER_CHAT_PROMPTS.map((label) => (
              <Pressable
                key={label}
                onPress={() => void appendExchange(label)}
                disabled={sending}
                className="rounded-full border border-[#E6E1DA] bg-white px-3 py-2 active:opacity-70"
              >
                <Text className="text-xs font-semibold text-[#0B0B0B]">{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>

        <View className="bg-[#F4F0EA] px-3 pb-4 pt-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              className="h-9 w-9 items-center justify-center rounded-full border border-[#E6E1DA] bg-white active:opacity-70"
            >
              <Ionicons name="add" size={24} color="#0B0B0B" />
            </Pressable>

            <View className="min-h-[44px] flex-1 flex-row items-center rounded-full border border-[#E6E1DA] bg-[#F0EBE3] px-4 py-1">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="What would you like to do today?"
                placeholderTextColor="rgba(95, 95, 95, 0.55)"
                className="min-h-[36px] flex-1 py-2 text-base text-[#0B0B0B]"
                editable={!sending}
                onSubmitEditing={() => {
                  void appendExchange(input);
                  setInput("");
                }}
                returnKeyType="send"
              />
              <Pressable
                accessibilityRole="button"
                className="ml-1 p-1 active:opacity-70"
                hitSlop={8}
              >
                <Ionicons name="mic-outline" size={22} color="rgba(95, 95, 95, 0.55)" />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void appendExchange(input);
                setInput("");
              }}
              disabled={sending || !input.trim()}
              className="h-9 w-9 items-center justify-center rounded-full bg-[#0B0B0B] active:opacity-80 disabled:opacity-40"
            >
              <Ionicons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
