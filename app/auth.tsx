import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AuthScreen() {
  const { session, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
  const inputStyle = Platform.select({
    ios: {minHeight: 28, paddingTop: 0, paddingBottom: 6},
    default: { minHeight: 28, paddingTop: 0, paddingBottom: 6 },
  });

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
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-10">
        <Text className="text-4xl font-black text-black">Venn</Text>
        <Text className="mt-2 text-base text-gray-600">Sign in or create your account.</Text>

        <View className="mt-8 gap-4">
          <View className="rounded-2xl border border-gray-200 px-4 py-3">
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor="#9CA3AF"
              className="text-base text-black"
              style={inputStyle}
            />
          </View>

          <View className="rounded-2xl border border-gray-200 px-4 py-3">
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Password (min 6 chars)"
              placeholderTextColor="#9CA3AF"
              className="text-base text-black"
              style={inputStyle}
            />
          </View>

          <Pressable
            onPress={() => void handleSignIn()}
            disabled={!canSubmit}
            className="items-center rounded-2xl bg-blue-500 px-5 py-4 active:opacity-80 disabled:opacity-40"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-base font-black text-white">Sign In</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => void handleSignUp()}
            disabled={!canSubmit}
            className="items-center rounded-2xl border border-blue-500 px-5 py-4 active:opacity-80 disabled:opacity-40"
          >
            <Text className="text-base font-black text-blue-500">Create Account</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
