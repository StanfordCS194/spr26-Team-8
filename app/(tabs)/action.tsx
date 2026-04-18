import { Ionicons } from "@expo/vector-icons";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ActionTab() {
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
          <View className="flex-1">
            <Text className="px-5 pt-3 text-4xl font-black text-black">
              Action
            </Text>
          </View>
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
                placeholder="What would you like to do today?"
                placeholderTextColor="#9CA3AF"
                className="min-h-[36px] flex-1 py-2 text-base text-black"
              />
              <Pressable
                accessibilityRole="button"
                className="ml-1 p-1 active:opacity-70"
                hitSlop={8}
              >
                <Ionicons name="mic-outline" size={22} color="#9CA3AF" />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
