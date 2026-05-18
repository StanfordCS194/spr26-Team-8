import { ONBOARDING_STOCK_IMAGES } from "@/lib/onboardingStockImages";
import { saveOnboardingProfile } from "@/lib/userProfile";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/posthog";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { isOnboardingComplete } from "@/lib/userProfile";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const STEPS = ["location", "interests", "optional"] as const;
type Step = (typeof STEPS)[number];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const tileGap = 10;
  const tileW = (width - 48 - tileGap) / 2;

  const [step, setStep] = useState<Step>("location");
  const [homeLocation, setHomeLocation] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [freeform, setFreeform] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (!cancelled) {
          setCheckingExisting(false);
          router.replace("/auth");
        }
        return;
      }
      const done = await isOnboardingComplete(uid);
      if (!cancelled) {
        setCheckingExisting(false);
        if (done) router.replace("/(tabs)/archive");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stepIndex = STEPS.indexOf(step);

  if (checkingExisting) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F4F0EA]">
        <ActivityIndicator size="small" color="#0B0B0B" />
      </View>
    );
  }

  const toggleImage = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const goNext = () => {
    if (step === "location") {
      if (!homeLocation.trim()) {
        Alert.alert("Location", "Tell us where you are based so Venn can suggest nearby ideas.");
        return;
      }
      track("onboarding_step", { step: "location" });
      setStep("interests");
      return;
    }
    if (step === "interests") {
      track("onboarding_step", { step: "interests", selected_count: selectedIds.length });
      setStep("optional");
      return;
    }
  };

  const goBack = () => {
    if (step === "interests") setStep("location");
    else if (step === "optional") setStep("interests");
  };

  const finish = async (skippedOptional: boolean) => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in again.");
      router.replace("/auth");
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingProfile(userId, {
        homeLocation,
        selectedStockImageIds: selectedIds,
        interestsFreeform: skippedOptional ? undefined : freeform,
      });
      track("onboarding_completed", {
        skipped_optional: skippedOptional,
        interest_count: selectedIds.length,
      });
      router.replace("/(tabs)/archive");
    } catch (e) {
      Alert.alert(
        "Could not save",
        e instanceof Error ? e.message : "Something went wrong saving your profile."
      );
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { fontSize: 18, paddingVertical: 6 };

  return (
    <SafeAreaView className="flex-1 bg-[#F4F0EA]">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-row items-center justify-between px-5 pt-2">
          {stepIndex > 0 ? (
            <Pressable onPress={goBack} hitSlop={12} className="active:opacity-60">
              <Ionicons name="chevron-back" size={24} color="#0B0B0B" />
            </Pressable>
          ) : (
            <View className="w-6" />
          )}
          <Text className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6B6B6B]">
            Set up · {stepIndex + 1}/{STEPS.length}
          </Text>
          <View className="w-6" />
        </View>

        <ScrollView
          className="flex-1 px-6"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
        >
          {step === "location" ? (
            <View className="pt-4">
              <Text className="text-4xl font-black tracking-[-0.5px] text-[#0B0B0B]">
                Where are you based?
              </Text>
              <Text className="mt-3 text-lg font-medium leading-6 text-[#5F5F5F]">
                City or neighborhood — we use this for local suggestions in chat and nudges.
              </Text>
              <View className="mt-6 rounded-2xl border-2 border-[#0B0B0B] bg-white px-4 py-4">
                <TextInput
                  value={homeLocation}
                  onChangeText={setHomeLocation}
                  placeholder="e.g. Palo Alto, CA"
                  placeholderTextColor="#8A8278"
                  autoCapitalize="words"
                  autoCorrect
                  className="font-semibold text-[#0B0B0B]"
                  style={inputStyle}
                />
              </View>
            </View>
          ) : null}

          {step === "interests" ? (
            <View className="pt-4">
              <Text className="text-4xl font-black tracking-[-0.5px] text-[#0B0B0B]">
                What feels like you?
              </Text>
              <Text className="mt-3 text-lg font-medium leading-6 text-[#5F5F5F]">
                Pick a few scenes. We use these like your Library photos to shape suggestions.
              </Text>
              <View className="mt-5 flex-row flex-wrap" style={{ gap: tileGap }}>
                {ONBOARDING_STOCK_IMAGES.map((img) => {
                  const selected = selectedIds.includes(img.id);
                  return (
                    <Pressable
                      key={img.id}
                      onPress={() => toggleImage(img.id)}
                      style={{ width: tileW }}
                      className={`overflow-hidden rounded-2xl border-2 ${
                        selected ? "border-[#0B7AEE]" : "border-[#E6E1DA]"
                      }`}
                    >
                      <Image
                        source={img.source}
                        style={{ width: tileW, height: tileW * 0.72 }}
                        contentFit="cover"
                      />
                      <View
                        className={`px-2 py-2 ${selected ? "bg-[#E8F2FF]" : "bg-white"}`}
                      >
                        <Text
                          className="text-xs font-semibold text-[#0B0B0B]"
                          numberOfLines={2}
                        >
                          {img.label}
                        </Text>
                      </View>
                      {selected ? (
                        <View className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-full bg-[#0B7AEE]">
                          <Ionicons name="checkmark" size={16} color="#fff" />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {step === "optional" ? (
            <View className="pt-4">
              <Text className="text-4xl font-black tracking-[-0.5px] text-[#0B0B0B]">
                Anything on your mind?
              </Text>
              <Text className="mt-3 text-lg font-medium leading-6 text-[#5F5F5F]">
                Optional — trips, hobbies, or things you have been meaning to do lately.
              </Text>
              <View className="mt-6 min-h-[140px] rounded-2xl border-2 border-[#0B0B0B] bg-white px-4 py-4">
                <TextInput
                  value={freeform}
                  onChangeText={setFreeform}
                  placeholder="e.g. Want to try more hikes, book a dentist visit, plan a weekend trip…"
                  placeholderTextColor="#8A8278"
                  multiline
                  textAlignVertical="top"
                  className="min-h-[120px] font-medium text-[#0B0B0B]"
                  style={{ fontSize: 17, lineHeight: 24 }}
                />
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View className="border-t border-[#E6E1DA] px-6 pb-8 pt-4">
          {step !== "optional" ? (
            <Pressable
              onPress={goNext}
              className="items-center rounded-2xl bg-[#0B0B0B] px-5 py-5 active:opacity-80"
            >
              <Text className="text-xl font-black text-white">Continue</Text>
            </Pressable>
          ) : (
            <View className="gap-3">
              <Pressable
                onPress={() => void finish(false)}
                disabled={saving}
                className="items-center rounded-2xl bg-[#0B0B0B] px-5 py-5 active:opacity-80 disabled:opacity-50"
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-xl font-black text-white">Finish</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => void finish(true)}
                disabled={saving}
                className="items-center py-2 active:opacity-70 disabled:opacity-50"
              >
                <Text className="text-base font-semibold text-[#5F5F5F]">Skip for now</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
