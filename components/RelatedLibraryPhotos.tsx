import type { RelatedMemoryThumbnail } from "@/lib/fetchMemoryThumbnailUrls";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

/** Horizontal thumbnails for memories tied to an assistant reply; opens that photo in Library. */
export function RelatedLibraryPhotos({ items }: { items: RelatedMemoryThumbnail[] }) {
  if (items.length === 0) return null;

  return (
    <View className="mt-4 w-full shrink-0">
      <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6B6B]">
        Related from Library
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2.5 pb-0.5">
          {items.map(({ memoryId, uri }) => (
            <Pressable
              key={memoryId}
              accessibilityRole="button"
              accessibilityLabel="Open photo in Library"
              onPress={() =>
                router.navigate({
                  pathname: "/(tabs)/archive",
                  params: { openMemoryId: memoryId },
                })
              }
              className="overflow-hidden rounded-xl active:opacity-80"
            >
              <Image
                source={{ uri }}
                style={{ width: 76, height: 76, borderRadius: 12, backgroundColor: "#EDE8DF" }}
                contentFit="cover"
              />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
