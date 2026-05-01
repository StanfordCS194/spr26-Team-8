import { MarkdownishBoldLine } from "@/components/MarkdownishBoldLine";
import { exportChatTextToFile } from "@/lib/chatExport";
import { CHAT_PROMPTS, sendChatMessage } from "@/lib/chat";
import { posthog } from "@/lib/posthog";
import { saveChatOutput } from "@/lib/savedChatOutputs";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type SelectedImage = {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
};

function AssistantMessageBody({ content }: { content: string }) {
  const lines = content.split(/\n/);
  return (
    <View className="gap-1.5">
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (line.trim() === "") {
          return <View key={`gap-${i}`} className="h-1" />;
        }
        return (
          <MarkdownishBoldLine
            key={`ln-${i}`}
            line={line}
            className="text-base leading-6 text-[#0B0B0B]"
            boldClassName="font-semibold"
          />
        );
      })}
    </View>
  );
}

export default function ActionTab() {
  const params = useLocalSearchParams<{
    prompt?: string | string[];
    autosend?: string | string[];
  }>();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [sending, setSending] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [savedMessageIds, setSavedMessageIds] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<ScrollView>(null);
  const chatSessionId = useRef(`chat-${Date.now()}`).current;

  const makeMessage = useCallback(
    (role: "user" | "assistant", text: string): ChatMessage => ({
      id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
    }),
    []
  );

  const appendExchange = useCallback(
    async (userText: string, opts?: { silent?: boolean }) => {
      const trimmed = userText.trim();
      if (!trimmed || sending) return;
      const silent = Boolean(opts?.silent);
      setShowQuickActions(false);
      setSending(true);
      if (!silent) {
        setMessages((m) => [...m, makeMessage("user", trimmed)]);
      }
      posthog.capture("chat_message_sent", {
        chat_session_id: chatSessionId,
        silent_handoff: silent ? 1 : 0,
      });
      try {
        const reply = await sendChatMessage(
          trimmed,
          silent ? { style: "inbox_action_plan" } : undefined
        );
        setMessages((m) => [...m, makeMessage("assistant", reply)]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          makeMessage(
            "assistant",
            err instanceof Error
              ? `Sorry, I could not generate a response: ${err.message}`
              : "Sorry, I could not generate a response right now."
          ),
        ]);
      } finally {
        setSending(false);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      }
    },
    [sending, chatSessionId, makeMessage]
  );

  useFocusEffect(
    useCallback(() => {
      const raw = params.prompt;
      const promptRaw = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
      if (!promptRaw) return undefined;

      const rawAuto = params.autosend;
      const autoFlag =
        rawAuto === "1" ||
        rawAuto === "true" ||
        (Array.isArray(rawAuto) && rawAuto.some((x) => x === "1" || x === "true"));

      let decoded = promptRaw;
      if (decoded.includes("%")) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          // Keep original if decoding fails (e.g. stray "%" from user content)
        }
      }

      const plain = decoded
        .replace(/\*\*/g, "")
        .replace(/\\\*/g, "")
        .trim();

      router.setParams({ prompt: undefined, autosend: undefined });

      if (plain.length > 0) {
        if (autoFlag) {
          void appendExchange(plain, { silent: true });
          setInput("");
        } else {
          setInput(plain);
          setShowQuickActions(false);
        }
      }
      return undefined;
    }, [params.prompt, params.autosend, appendExchange])
  );

  const pickImages = useCallback(async () => {
    if (sending) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessages((m) => [
        ...m,
        makeMessage("assistant", "Please allow photo library access to attach images."),
      ]);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1,
    });

    if (result.canceled) return;

    setSelectedImages((prev) => {
      const next = [
        ...prev,
        ...result.assets.map((a) => ({
          uri: a.uri,
          width: a.width,
          height: a.height,
          fileName: a.fileName ?? null,
        })),
      ];

      const seen = new Set<string>();
      return next.filter((img) => {
        if (seen.has(img.uri)) return false;
        seen.add(img.uri);
        return true;
      });
    });
  }, [sending, makeMessage]);

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <KeyboardAvoidingView
        className="flex-1 bg-[#F4F0EA]"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-1 bg-[#F4F0EA]">
          <SafeAreaView className="flex-1 bg-[#F4F0EA]" edges={["left", "right", "bottom"]}>
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
              {messages.map((msg) => (
                <View
                  key={msg.id}
                  className={`mb-3 max-w-[92%] rounded-3xl px-4 py-3 ${
                    msg.role === "user"
                      ? "self-end bg-[#0B0B0B]"
                      : "self-start border border-[#E6E1DA] bg-white shadow-sm"
                  }`}
                >
                  {msg.role === "user" ? (
                    <Text className="text-base leading-6 text-white">{msg.text}</Text>
                  ) : (
                    <View>
                      <AssistantMessageBody content={msg.text} />
                      <View className="mt-2 flex-row justify-end">
                        <View className="flex-row items-center gap-2">
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Download chat output"
                            onPress={() => {
                              void exportChatTextToFile(msg.text, msg.text)
                                .then(() => Alert.alert("Download", "Use the share sheet to save this to Files."))
                                .catch((err) =>
                                  Alert.alert(
                                    "Download failed",
                                    err instanceof Error ? err.message : "Could not export output."
                                  )
                                );
                            }}
                            className="flex-row items-center gap-1 rounded-full border border-[#E6E1DA] bg-[#FFFCF8] px-2.5 py-1.5 active:opacity-80"
                          >
                            <Ionicons name="download-outline" size={14} color="#0B0B0B" />
                            <Text className="text-xs font-semibold text-[#0B0B0B]">Download</Text>
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
                            className="flex-row items-center gap-1 rounded-full border border-[#E6E1DA] bg-[#FFFCF8] px-2.5 py-1.5 active:opacity-80 disabled:opacity-60"
                          >
                            <Ionicons
                              name={savedMessageIds[msg.id] ? "bookmark" : "bookmark-outline"}
                              size={14}
                              color="#0B0B0B"
                            />
                            <Text className="text-xs font-semibold text-[#0B0B0B]">
                              {savedMessageIds[msg.id] ? "Saved" : "Save"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              ))}
              {sending ? (
                <View className="flex-row items-center gap-2 py-2">
                  <ActivityIndicator size="small" color="#0B0B0B" />
                  <Text className="text-sm text-[#5F5F5F]">Working...</Text>
                </View>
              ) : null}
            </ScrollView>

            {showQuickActions ? (
              <View className="border-t border-[#EFE8DF] bg-[#F4F0EA] px-4 pb-2 pt-3">
                <View className="flex-row flex-wrap gap-3">
                  {CHAT_PROMPTS.map((label) => (
                    <Pressable
                      key={label}
                      onPress={() => void appendExchange(label)}
                      disabled={sending}
                      className="min-h-[92px] w-[48%] justify-center overflow-hidden rounded-[26px] border border-[#D9D2C7] bg-[#FFFCF8] px-4 py-4 shadow-sm active:opacity-70"
                    >
                      <Text
                        className="text-[15px] font-semibold leading-5 tracking-[-0.1px] text-[#0B0B0B]"
                        numberOfLines={4}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </SafeAreaView>

          <View className="bg-[#F4F0EA] px-3 pb-4 pt-2">
            {selectedImages.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mb-2"
                contentContainerClassName="gap-2 px-1"
              >
                {selectedImages.map((img) => (
                  <View key={img.uri} className="relative">
                    <Image
                      source={{ uri: img.uri }}
                      contentFit="cover"
                      className="h-16 w-16 rounded-2xl border border-[#E6E1DA] bg-white"
                    />
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setSelectedImages((prev) => prev.filter((p) => p.uri !== img.uri))
                      }
                      hitSlop={10}
                      className="absolute -right-1 -top-1 h-6 w-6 items-center justify-center rounded-full bg-[#0B0B0B] active:opacity-80"
                    >
                      <Ionicons name="close" size={14} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                onPress={() => void pickImages()}
                disabled={sending}
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
                  className="min-h-[36px] flex-1 text-[#0B0B0B]"
                  style={{ fontSize: 16, lineHeight: 22, paddingVertical: 0 }}
                  multiline={false}
                  scrollEnabled={false}
                  textAlignVertical="center"
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
    </View>
  );
}
