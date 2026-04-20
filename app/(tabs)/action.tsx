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
      text: "Placeholder chat — connect `placeholder_sendChatMessage` to your API in lib/teamIntegrationPlaceholders.ts.",
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
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "[Placeholder] Chat request failed — add error handling when you integrate the real API.",
        },
      ]);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [sending]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 bg-white">
        <SafeAreaView
          className="flex-1 bg-white"
          edges={["top", "left", "right"]}
        >
          <Text className="px-5 pt-3 text-4xl font-black text-black">Action</Text>
          <Text className="px-5 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Generative chat (placeholder)
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
                className={`mb-3 max-w-[92%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "self-end bg-blue-500"
                    : "self-start border border-gray-200 bg-gray-50"
                }`}
              >
                <Text
                  className={`text-base leading-6 ${
                    msg.role === "user" ? "text-white" : "text-gray-900"
                  }`}
                >
                  {msg.text}
                </Text>
              </View>
            ))}
            {sending ? (
              <View className="flex-row items-center gap-2 py-2">
                <ActivityIndicator size="small" color="#3B82F6" />
                <Text className="text-sm text-gray-500">Waiting (placeholder)…</Text>
              </View>
            ) : null}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="border-t border-gray-100 px-3 pt-2"
            contentContainerClassName="flex-row gap-2 pr-2"
          >
            {PLACEHOLDER_CHAT_PROMPTS.map((label) => (
              <Pressable
                key={label}
                onPress={() => void appendExchange(label)}
                disabled={sending}
                className="rounded-full border border-gray-200 bg-white px-3 py-2 active:opacity-70"
              >
                <Text className="text-xs font-bold text-gray-800">{label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>

        <View className="bg-white px-3 pb-4 pt-2">
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              className="h-9 w-9 items-center justify-center rounded-full bg-gray-200 active:opacity-70"
            >
              <Ionicons name="add" size={24} color="#374151" />
            </Pressable>

            <View className="min-h-[44px] flex-1 flex-row items-center rounded-full border border-gray-200 bg-gray-100 px-4 py-1">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="What would you like to do today?"
                placeholderTextColor="#9CA3AF"
                className="min-h-[36px] flex-1 py-2 text-base text-black"
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
                <Ionicons name="mic-outline" size={22} color="#9CA3AF" />
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void appendExchange(input);
                setInput("");
              }}
              disabled={sending || !input.trim()}
              className="h-9 w-9 items-center justify-center rounded-full bg-blue-500 active:opacity-80 disabled:opacity-40"
            >
              <Ionicons name="send" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
