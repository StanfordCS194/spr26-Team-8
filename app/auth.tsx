import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AuthScreen() {
  const { session, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) {
    return null;
  }

  if (session) {
    return <Redirect href="/(tabs)/archive" />;
  }

  const normalizedEmail = email.trim();
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const canSubmit = isValidEmail && password.trim().length >= 6 && !isSubmitting;
  // NativeWind's text-lg sneaks a lineHeight onto TextInput which clips descenders on iOS (RN issue #41240)
  // so we set fontSize manually and skip the className for size, keeping symmetric padding for vertical centering
  const inputStyle = { fontSize: 18, paddingVertical: 6 };

  const handleSignIn = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: password.trim(),
    });
    setIsSubmitting(false);

    if (error) {
      Alert.alert("Sign in failed", error.message);
      return;
    }

    router.replace("/(tabs)/archive");
  };

  const handleSignUp = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: password.trim(),
    });
    setIsSubmitting(false);

    if (error) {
      Alert.alert("Sign up failed", error.message);
      return;
    }

    Alert.alert("Check your email", "If email confirmation is enabled, open the link to finish signup.");
    router.replace("/(tabs)/archive");
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F4F0EA]">
      <View className="flex-1 px-6 pt-10">
        <Text className="text-5xl font-black text-[#0B0B0B]">Venn</Text>
        <Text className="mt-3 text-xl font-bold text-[#0B0B0B]">Sign in or create your account.</Text>

        <View className="mt-8 gap-4">
          {/* white fill + thick black border pops against the warm canvas */}
          <View className="rounded-2xl border-2 border-[#0B0B0B] bg-white px-4 py-4">
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor="#5F5F5F"
              className="font-semibold text-[#0B0B0B]"
              style={inputStyle}
            />
          </View>

          <View className="flex-row items-center rounded-2xl border-2 border-[#0B0B0B] bg-white px-4 py-4">
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              placeholder="Password (min 6 chars)"
              placeholderTextColor="#5F5F5F"
              className="flex-1 font-semibold text-[#0B0B0B]"
              style={inputStyle}
            />
            {/* explicit size so the Pressable can't collapse next to a flex-1 sibling */}
            <Pressable
              onPress={() => setShowPassword((s) => !s)}
              hitSlop={12}
              className="ml-3 h-8 w-8 items-center justify-center active:opacity-60"
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <Ionicons
                name={showPassword ? "eye-off" : "eye"}
                size={26}
                color="#0B0B0B"
              />
            </Pressable>
          </View>

          <Pressable
            onPress={() => void handleSignIn()}
            disabled={!canSubmit}
            className="items-center rounded-2xl bg-[#0B0B0B] px-5 py-5 active:opacity-80 disabled:opacity-40"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-xl font-black text-white">Sign In</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void handleSignUp()}
            disabled={!canSubmit}
            className="items-center rounded-2xl border-2 border-[#0B0B0B] px-5 py-5 active:opacity-80 disabled:opacity-40"
          >
            <Text className="text-xl font-black text-[#0B0B0B]">Create Account</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
