import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";

export default function Index() {
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      router.replace("/(tabs)/archive");
    }, 900);

    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <View className="flex-row items-end">
        <Text className="text-[84px] font-black leading-[92px] tracking-[1px] text-blue-500">
          V
        </Text>
        <Text className="text-[84px] font-black leading-[92px] tracking-[1px] text-[#10E070]">
          e
        </Text>
        <Text className="text-[84px] font-black leading-[92px] tracking-[1px] text-[#FF4D4D]">
          n
        </Text>
        <Text className="text-[84px] font-black leading-[92px] tracking-[1px] text-[#FF4FD8]">
          n
        </Text>
      </View>
      <Text className="mt-3 text-base font-black uppercase tracking-[1.5px] text-black">
        Loading...
      </Text>
      <View className="mt-2.5">
        <ActivityIndicator size="small" color="black" />
      </View>
    </View>
  );
}
