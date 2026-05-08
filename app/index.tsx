import { router } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";

export default function Index() {
  const { session, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;

    const timeoutId = setTimeout(() => {
      if (session) {
        router.replace("/(tabs)/archive");
      } else {
        router.replace("/auth");
      }
    }, 900);

    return () => clearTimeout(timeoutId);
  }, [isLoading, session]);

  return (
    <View className="flex-1 items-center justify-center bg-[#F4F0EA]">
      <Image
        source={require("@/assets/images/splash-icon.png")}
        style={{ width: 200, height: 200 }}
        resizeMode="contain"
      />
      <Text className="mt-3 text-sm font-semibold tracking-[2px] text-[#5F5F5F]">
        Loading
      </Text>
      <View className="mt-2.5">
        <ActivityIndicator size="small" color="#0B0B0B" />
      </View>
    </View>
  );
}
