import { sendChatMessage } from "@/lib/chat";
import { exportChatTextToFile } from "@/lib/chatExport";
import { saveChatOutput } from "@/lib/savedChatOutputs";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
const MINI_CHAT_STARTER_PROMPTS = [
  "Create a bucket list for this weekend",
  "Draft a short weekend itinerary",
];

export function MiniChatWindow() {
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [savedMessageIds, setSavedMessageIds] = useState<Record<string, boolean>>({});
  const [chatHeight, setChatHeight] = useState(500);
  const scrollRef = useRef<ScrollView>(null);
  const startHeightRef = useRef(500);
  const minHeight = 280;
  const maxHeight = Math.max(minHeight, windowHeight - 100);

  const resizePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startHeightRef.current = chatHeight;
      },
      onPanResponderMove: (_, gestureState) => {
        // Drag up to increase height, drag down to decrease.
        const nextH = Math.max(
          minHeight,
          Math.min(maxHeight, startHeightRef.current - gestureState.dy)
        );
        setChatHeight(nextH);
      },
    })
  ).current;

  const send = async (userText?: string) => {
    const trimmed = (userText ?? input).trim();
    if (!trimmed || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [
      ...m,
      { id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "user", text: trimmed },
    ]);
    try {
      const reply = await sendChatMessage(trimmed);
      setMessages((m) => [
        ...m,
        {
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          text: reply,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open chat"
        onPress={() => setOpen(true)}
        hitSlop={8}
        className="rounded-full p-1.5 active:bg-black/5"
      >
        <Ionicons name="chatbubble-ellipses-outline" size={23} color="#2C2C2C" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable className="flex-1 bg-black/30" onPress={() => setOpen(false)} />
          <View
            className="self-center rounded-t-3xl border-t border-[#E6E1DA] bg-[#F4F0EA]"
            style={{ width: "94%", height: chatHeight }}
          >
            <View
              className="absolute left-1/2 top-0 z-20 h-8 w-24 -translate-x-12 items-center justify-center"
              {...resizePanResponder.panHandlers}
            >
              <View className="h-5 w-16 items-center justify-center rounded-full bg-black/5">
                <View className="h-1 w-8 rounded-full bg-[#8A8278]" />
              </View>
            </View>
            <View className="flex-row items-center justify-between border-b border-[#E6E1DA] px-4 py-3">
              <Text className="text-base font-semibold text-[#0B0B0B]">Chat</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close chat"
                onPress={() => setOpen(false)}
                className="rounded-full p-1 active:bg-black/5"
              >
                <Ionicons name="close" size={22} color="#2C2C2C" />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              className="flex-1 px-4 pt-3"
              contentContainerStyle={{ flexGrow: 0, paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {messages.length === 0 ? (
                <View className="gap-3">
                  <Text className="text-sm text-[#6B6B6B]">
                    Ask anything about your saved memories, plans, or to-dos.
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {MINI_CHAT_STARTER_PROMPTS.map((prompt) => (
                      <Pressable
                        key={prompt}
                        onPress={() => void send(prompt)}
                        disabled={sending}
                        className="min-h-[64px] w-[48%] justify-center rounded-2xl border border-[#D9D2C7] bg-[#FFFCF8] px-3 py-3 active:opacity-70 disabled:opacity-40"
                      >
                        <Text className="text-[14px] font-semibold leading-5 text-[#0B0B0B]">
                          {prompt}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {messages.map((msg) =>
                msg.role === "user" ? (
                  <View
                    key={msg.id}
                    className="mb-2.5 max-w-[92%] shrink-0 self-end rounded-2xl bg-[#0B0B0B] px-3.5 py-2.5"
                  >
                    <Text className="text-sm leading-5 text-white">{msg.text}</Text>
                  </View>
                ) : (
                  <View
                    key={msg.id}
                    collapsable={Platform.OS === "android" ? false : undefined}
                    className="mb-2.5 max-w-[85%] shrink-0 self-start rounded-2xl"
                    style={
                      Platform.OS === "ios"
                        ? {
                            shadowColor: "#000000",
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.05,
                            shadowRadius: 3,
                          }
                        : undefined
                    }
                  >
                    <View
                      collapsable={Platform.OS === "android" ? false : undefined}
                      className="w-full shrink-0 overflow-hidden rounded-2xl border border-[#E6E1DA] bg-white px-5 py-2.5"
                      style={
                        Platform.OS === "android"
                          ? {
                              elevation: 2,
                            }
                          : undefined
                      }
                    >
                      <View className="w-full shrink-0">
                        <Text className="text-sm leading-5 text-[#0B0B0B]">{msg.text}</Text>
                      </View>
                      <View className="mt-4 w-full shrink-0 border-t border-[#EDE8DF] pt-3">
                        <View className="shrink-0 flex-row justify-end gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Download chat output"
                            onPress={() => {
                              void exportChatTextToFile(msg.text, msg.text)
                                .then(() =>
                                  Alert.alert("Download", "Use the share sheet to save this to Files.")
                                )
                                .catch((err) =>
                                  Alert.alert(
                                    "Download failed",
                                    err instanceof Error ? err.message : "Could not export output."
                                  )
                                );
                            }}
                            className="flex-row items-center gap-1 rounded-full border border-[#DDD7CC] bg-[#FFFCF8] px-2 py-1 active:opacity-80"
                          >
                            <Ionicons name="download-outline" size={12} color="#0B0B0B" />
                            <Text className="text-[11px] font-semibold text-[#0B0B0B]">Download</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Save chat output"
                            onPress={() => {
                              void saveChatOutput(msg.text).then(() =>
                                setSavedMessageIds((prev) => ({ ...prev, [msg.id]: true }))
                              );
                            }}
                            disabled={Boolean(savedMessageIds[msg.id])}
                            className="flex-row items-center gap-1 rounded-full border border-[#DDD7CC] bg-[#FFFCF8] px-2 py-1 active:opacity-80 disabled:opacity-60"
                          >
                            <Ionicons
                              name={savedMessageIds[msg.id] ? "bookmark" : "bookmark-outline"}
                              size={12}
                              color="#0B0B0B"
                            />
                            <Text className="text-[11px] font-semibold text-[#0B0B0B]">
                              {savedMessageIds[msg.id] ? "Saved" : "Save"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </View>
                )
              )}
              {sending ? (
                <View className="flex-row items-center gap-2 py-1">
                  <ActivityIndicator size="small" color="#0B0B0B" />
                  <Text className="text-xs text-[#5F5F5F]">Thinking...</Text>
                </View>
              ) : null}
            </ScrollView>

            <View className="border-t border-[#E6E1DA] bg-[#F4F0EA] px-3 pb-4 pt-3">
              <View className="flex-row items-center gap-2">
                <View className="min-h-[42px] flex-1 flex-row items-center rounded-full border border-[#E6E1DA] bg-[#F0EBE3] px-4">
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder="Message..."
                    placeholderTextColor="rgba(95,95,95,0.55)"
                    className="min-h-[36px] flex-1 text-[#0B0B0B]"
                    editable={!sending}
                    onSubmitEditing={() => void send()}
                    returnKeyType="send"
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void send()}
                  disabled={sending || !input.trim()}
                  className="h-9 w-9 items-center justify-center rounded-full bg-[#0B0B0B] active:opacity-80 disabled:opacity-40"
                >
                  <Ionicons name="send" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
