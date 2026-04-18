import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import type { ImageSourcePropType } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ContextModule = {
  keys: () => string[];
  (id: string): number;
};

type RequireWithContext = NodeRequire & {
  context: (path: string, recursive?: boolean, filter?: RegExp) => ContextModule;
};

const imageHeights = [220, 280, 200, 260];
const uploadsDir = `${FileSystem.documentDirectory ?? ""}files`;

type BoardItem = {
  id: string;
  source: ImageSourcePropType;
  height: number;
};

const imagesContext = (require as RequireWithContext).context(
  "../../assets/files",
  false,
  /\.(png|jpe?g|webp|gif)$/i
);

const bundledItems: BoardItem[] = imagesContext
  .keys()
  .sort((a, b) => a.localeCompare(b))
  .map((key, index) => ({
    id: key,
    source: imagesContext(key),
    height: imageHeights[index % imageHeights.length],
  }));

export default function ArchiveTab() {
  const [uploadedItems, setUploadedItems] = useState<BoardItem[]>([]);

  useEffect(() => {
    const loadUploadedFiles = async () => {
      try {
        if (!FileSystem.documentDirectory) return;

        const dirInfo = await FileSystem.getInfoAsync(uploadsDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(uploadsDir, { intermediates: true });
          setUploadedItems([]);
          return;
        }

        const fileNames = await FileSystem.readDirectoryAsync(uploadsDir);
        const imageNames = fileNames
          .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
          .sort((a, b) => a.localeCompare(b));

        const nextUploadedItems: BoardItem[] = imageNames.map((name, index) => ({
          id: `uploaded-${name}`,
          source: { uri: `${uploadsDir}/${name}` },
          height: imageHeights[(bundledItems.length + index) % imageHeights.length],
        }));

        setUploadedItems(nextUploadedItems);
      } catch {
        Alert.alert("Upload", "Could not load uploaded files.");
      }
    };

    void loadUploadedFiles();
  }, []);

  const boardItems = useMemo(
    () => [...bundledItems, ...uploadedItems],
    [uploadedItems]
  );
  const leftColumnItems = boardItems.filter((_, index) => index % 2 === 0);
  const rightColumnItems = boardItems.filter((_, index) => index % 2 === 1);

  const handleUpload = async () => {
    try {
      if (!FileSystem.documentDirectory) {
        Alert.alert("Upload", "File storage is unavailable on this device.");
        return;
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Upload", "Please allow photo library access to upload images.");
        return;
      }

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });

      if (picked.canceled || !picked.assets.length) {
        return;
      }

      const asset = picked.assets[0];
      const fallbackName = asset.uri.split("/").pop() || `upload-${Date.now()}.jpg`;
      const rawName = asset.fileName || fallbackName;
      const sanitizedName = rawName.replace(/[^\w.\-]/g, "_");
      const fileName = `${Date.now()}-${sanitizedName}`;
      const destinationUri = `${uploadsDir}/${fileName}`;

      await FileSystem.makeDirectoryAsync(uploadsDir, { intermediates: true });
      await FileSystem.copyAsync({ from: asset.uri, to: destinationUri });

      setUploadedItems((current) => [
        ...current,
        {
          id: `uploaded-${fileName}`,
          source: { uri: destinationUri },
          height: imageHeights[(bundledItems.length + current.length) % imageHeights.length],
        },
      ]);
    } catch {
      Alert.alert("Upload", "Could not upload this file.");
    }
  };

  return (
    <View className="flex-1 bg-white">
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView contentContainerClassName="px-5 pb-8">
          <Text className="pt-3 text-4xl font-black text-black">Archive</Text>
          <Pressable
            className="mt-4 items-center rounded-2xl bg-blue-500 px-5 py-4"
            onPress={handleUpload}
          >
            <Text className="text-lg font-black text-white">Upload</Text>
          </Pressable>
          <Text className="pt-3 text-sm text-gray-500">
            Upload screenshots, files, notes, and more.
          </Text>

          <View className="mt-5 flex-row gap-3">
            <View className="flex-1 gap-3">
              {leftColumnItems.map((item) => (
                <View key={item.id} className="overflow-hidden rounded-2xl bg-gray-100">
                  <Image
                    source={item.source}
                    style={{ width: "100%", height: item.height }}
                    resizeMode="cover"
                  />
                </View>
              ))}
            </View>

            <View className="flex-1 gap-3">
              {rightColumnItems.map((item) => (
                <View key={item.id} className="overflow-hidden rounded-2xl bg-gray-100">
                  <Image
                    source={item.source}
                    style={{ width: "100%", height: item.height }}
                    resizeMode="cover"
                  />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
