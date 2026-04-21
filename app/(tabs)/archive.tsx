import type { ArchiveItemMeta, ArchiveSearchMatchHighlight } from "@/lib/archiveSearchAndCluster";
import {
  archiveIndexForBackend,
  distinctThemes,
  enrichArchiveRows,
  fileNameFromArchiveId,
  hydrateArchiveMeta,
  mergeArchiveMeta,
  searchAndRankArchiveRows,
} from "@/lib/archiveSearchAndCluster";
import { loadSupplementalSearchText, upsertSupplementalSearchText } from "@/lib/archiveSupplementalSearchText";
import {
  placeholder_extractSearchableTextFromImage,
  placeholder_fetchEmbeddingThemeOverrides,
  placeholder_fetchRemoteArchiveMeta,
  placeholder_notifyArchiveIndexUpdated,
} from "@/lib/teamIntegrationPlaceholders";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
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

type GridCell = {
  item: BoardItem;
  highlights: ArchiveSearchMatchHighlight[];
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
  const [meta, setMeta] = useState<Record<string, ArchiveItemMeta>>({});
  const [themeOverrides, setThemeOverrides] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [themeFilter, setThemeFilter] = useState<"all" | string>("all");
  const [supplementalSearchById, setSupplementalSearchById] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null);

  useEffect(() => {
    void loadSupplementalSearchText().then(setSupplementalSearchById);
  }, []);

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

  useEffect(() => {
    const ids = boardItems.map((item) => ({
      id: item.id,
      fileName: fileNameFromArchiveId(item.id),
    }));

    let cancelled = false;
    void (async () => {
      const local = await hydrateArchiveMeta(ids);
      const remote = await placeholder_fetchRemoteArchiveMeta(ids);
      const merged = mergeArchiveMeta(local, remote);
      if (!cancelled) setMeta(merged);

      const embeddingThemes = await placeholder_fetchEmbeddingThemeOverrides(ids);
      if (!cancelled) setThemeOverrides(embeddingThemes);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardItems]);

  const indexRows = useMemo(
    () =>
      enrichArchiveRows(boardItems.map((b) => b.id), meta, {
        themeOverrides,
        searchableTextById: supplementalSearchById,
      }),
    [boardItems, meta, themeOverrides, supplementalSearchById]
  );

  const indexPayload = useMemo(() => archiveIndexForBackend(indexRows), [indexRows]);

  useEffect(() => {
    void placeholder_notifyArchiveIndexUpdated(indexPayload);
  }, [indexPayload]);

  const searchResults = useMemo(
    () => searchAndRankArchiveRows(indexRows, searchQuery, themeFilter),
    [indexRows, searchQuery, themeFilter]
  );

  const themeOptions = useMemo(() => distinctThemes(indexRows), [indexRows]);

  const itemsById = useMemo(
    () => new Map(boardItems.map((item) => [item.id, item] as const)),
    [boardItems]
  );

  const gridCells = useMemo((): GridCell[] => {
    return searchResults
      .map((result) => {
        const item = itemsById.get(result.row.id);
        if (!item) return null;
        return { item, highlights: result.highlights };
      })
      .filter((cell): cell is GridCell => Boolean(cell));
  }, [searchResults, itemsById]);

  const leftColumnCells = gridCells.filter((_, index) => index % 2 === 0);
  const rightColumnCells = gridCells.filter((_, index) => index % 2 === 1);

  const showMatchHints = searchQuery.trim().length > 0;

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

      const newId = `uploaded-${fileName}`;

      setUploadedItems((current) => [
        ...current,
        {
          id: newId,
          source: { uri: destinationUri },
          height: imageHeights[(bundledItems.length + current.length) % imageHeights.length],
        },
      ]);

      void (async () => {
        try {
          const visionText = await placeholder_extractSearchableTextFromImage(destinationUri, {
            id: newId,
            fileName,
          });
          if (!visionText.trim()) return;
          const next = await upsertSupplementalSearchText(newId, visionText);
          setSupplementalSearchById(next);
        } catch {
          /* vision pipeline optional */
        }
      })();
    } catch {
      Alert.alert("Upload", "Could not upload this file.");
    }
  };

  return (
    <View className="flex-1 bg-white">
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
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

          <View className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2">
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search names, tags, themes…"
              placeholderTextColor="#9CA3AF"
              className="py-2 text-base text-black"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <Text className="mt-1 text-xs text-gray-400">
            All words must match. Stronger matches (file name, exact tags) sort first. OCR / in-image text can
            merge into the same index — enable{" "}
            <Text className="font-mono text-gray-500">useVisionTextExtraction</Text> in
            teamIntegrationPlaceholders when your vision backend or native module is ready.
          </Text>

          <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Clusters (auto from filenames)
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-2"
            contentContainerClassName="flex-row gap-2 pr-1"
          >
            <Pressable
              onPress={() => setThemeFilter("all")}
              className={`rounded-full px-4 py-2 ${
                themeFilter === "all" ? "bg-black" : "border border-gray-200 bg-white"
              }`}
            >
              <Text
                className={`text-sm font-black ${
                  themeFilter === "all" ? "text-white" : "text-gray-800"
                }`}
              >
                All
              </Text>
            </Pressable>
            {themeOptions.map((theme) => {
              const active = themeFilter === theme;
              return (
                <Pressable
                  key={theme}
                  onPress={() => setThemeFilter(active ? "all" : theme)}
                  className={`rounded-full px-4 py-2 ${
                    active ? "bg-blue-500" : "border border-gray-200 bg-white"
                  }`}
                >
                  <Text
                    className={`text-sm font-black capitalize ${
                      active ? "text-white" : "text-gray-800"
                    }`}
                  >
                    {theme}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {gridCells.length === 0 ? (
            <Text className="mt-6 text-center text-sm text-gray-500">
              Nothing matches this search or cluster. Clear filters to see everything again.
            </Text>
          ) : null}

          <View className="mt-5 flex-row gap-3">
            <View className="flex-1 gap-3">
              {leftColumnCells.map(({ item, highlights }) => (
                <Pressable key={item.id} onPress={() => setSelectedItem(item)} className="overflow-hidden rounded-2xl bg-gray-100">
                  <Image
                    source={item.source}
                    style={{ width: "100%", height: item.height }}
                    resizeMode="cover"
                  />
                  {showMatchHints && highlights.length > 0 ? (
                    <View className="border-t border-gray-200 bg-white px-2 py-1.5">
                      {highlights.slice(0, 2).map((h, idx) => (
                        <Text
                          key={`${item.id}-${h.kind}-${h.value}-${idx}`}
                          numberOfLines={1}
                          className="text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                        >
                          {h.label}: {h.value}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>

            <View className="flex-1 gap-3">
              {rightColumnCells.map(({ item, highlights }) => (
                <Pressable key={item.id} onPress={() => setSelectedItem(item)} className="overflow-hidden rounded-2xl bg-gray-100">
                  <Image
                    source={item.source}
                    style={{ width: "100%", height: item.height }}
                    resizeMode="cover"
                  />
                  {showMatchHints && highlights.length > 0 ? (
                    <View className="border-t border-gray-200 bg-white px-2 py-1.5">
                      {highlights.slice(0, 2).map((h, idx) => (
                        <Text
                          key={`${item.id}-${h.kind}-${h.value}-${idx}`}
                          numberOfLines={1}
                          className="text-[10px] font-semibold uppercase tracking-wide text-gray-500"
                        >
                          {h.label}: {h.value}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>

        <Modal visible={!!selectedItem} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
          <Pressable className="flex-1 items-center justify-center bg-black/60" onPress={() => setSelectedItem(null)}>
            {selectedItem ? (
              <Image
                source={selectedItem.source}
                style={{ width: "85%", height: "70%", borderRadius: 16 }}
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
