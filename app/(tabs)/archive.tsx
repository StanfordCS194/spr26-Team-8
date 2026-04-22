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
import { loadSupplementalSearchText, removeSupplementalSearchText, upsertSupplementalSearchText } from "@/lib/archiveSupplementalSearchText";
import {
  placeholder_extractSearchableTextFromImage,
  placeholder_fetchEmbeddingThemeOverrides,
  placeholder_fetchRemoteArchiveMeta,
  placeholder_notifyArchiveIndexUpdated,
} from "@/lib/teamIntegrationPlaceholders";
import { supabase } from "@/lib/supabase";
import { decode } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ImageSourcePropType } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const imageHeights = [220, 280, 200, 260];

type BoardItem = {
  id: string;
  source: ImageSourcePropType;
  height: number;
};

type GridCell = {
  item: BoardItem;
  highlights: ArchiveSearchMatchHighlight[];
};

type MemoryFileRow = {
  memory_id: string;
  files: { storage_path: string } | { storage_path: string }[] | null;
};

const isJpegAsset = (mimeType?: string | null, fileName?: string | null) => {
  const mime = (mimeType ?? "").toLowerCase();
  const name = (fileName ?? "").toLowerCase();
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    name.endsWith(".jpeg") ||
    name.endsWith(".jpg")
  );
};

const searchInputStyles = StyleSheet.create({
  field: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    lineHeight: 20,
    color: "#0B0B0B",
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  android: {
    textAlignVertical: "center",
  },
});

export default function ArchiveTab() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [meta, setMeta] = useState<Record<string, ArchiveItemMeta>>({});
  const [themeOverrides, setThemeOverrides] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [themeFilter, setThemeFilter] = useState<"all" | string>("all");
  const [supplementalSearchById, setSupplementalSearchById] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null);
  const [pendingAsset, setPendingAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    void loadSupplementalSearchText().then(setSupplementalSearchById);
  }, []);

  const loadItems = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return setItems([]);

    const { data } = await supabase
      .from("memories")
      .select("memory_id, files(storage_path)")
      .eq("user_id", user.id)
      .not("file_id", "is", null)
      .order("memory_id", { ascending: true });

    const entries = ((data as MemoryFileRow[] | null) ?? []).flatMap((m) => {
      const file = Array.isArray(m.files) ? m.files[0] : m.files;
      return file ? [{ memory_id: m.memory_id, storage_path: file.storage_path }] : [];
    });
    if (entries.length === 0) return setItems([]);

    const { data: signed } = await supabase.storage
      .from("memories")
      .createSignedUrls(entries.map((e) => e.storage_path), 60 * 60);

    setItems(
      (signed ?? []).flatMap((s, i) =>
        s.signedUrl
          ? [{
              id: `uploaded-${entries[i].memory_id}`,
              source: { uri: s.signedUrl },
              height: imageHeights[i % imageHeights.length],
            }]
          : []
      )
    );
  }, []);

  useEffect(() => {
    void loadItems();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void loadItems();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [loadItems]);

  useEffect(() => {
    const ids = items.map((item) => ({
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
  }, [items]);

  const indexRows = useMemo(
    () =>
      enrichArchiveRows(items.map((b) => b.id), meta, {
        themeOverrides,
        searchableTextById: supplementalSearchById,
      }),
    [items, meta, themeOverrides, supplementalSearchById]
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
    () => new Map(items.map((item) => [item.id, item] as const)),
    [items]
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

  const handlePickImage = async () => {
    const fail = (msg: string) => Alert.alert("Upload", msg);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return fail("Please allow photo library access to upload images.");
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (picked.canceled || !picked.assets.length) return;
      setPendingAsset(picked.assets[0]);
    } catch {
      fail("Could not open photo library.");
    }
  };

  const handleConfirmUpload = async (caption: string) => {
    if (!pendingAsset) return;
    const asset = pendingAsset;
    setPendingAsset(null);
    setCaptionDraft("");
    setIsUploading(true);

    const fail = (msg: string) => Alert.alert("Upload", msg);
    try {
      const rawName = asset.fileName || asset.uri.split("/").pop() || `upload-${Date.now()}.jpg`;
      const sanitizedBaseName = rawName
        .replace(/[^\w.\-]/g, "_")
        .replace(/\.(heic|heif|png|jpg|jpeg)$/i, "");
      let fileName = `${Date.now()}-${rawName.replace(/[^\w.\-]/g, "_")}`;
      let contentType = "image/jpeg";
      let uploadUri = asset.uri;

      if (!isJpegAsset(asset.mimeType, rawName)) {
        const converted = await ImageManipulator.manipulateAsync(
          asset.uri,
          [],
          { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );
        uploadUri = converted.uri;
        fileName = `${Date.now()}-${sanitizedBaseName}.jpeg`;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return fail("Could not identify the current user.");

      if (asset.fileName) {
        const sanitizedName = isJpegAsset(asset.mimeType, rawName)
          ? asset.fileName.replace(/[^\w.\-]/g, "_")
          : `${sanitizedBaseName}.jpeg`;
        const { data: existing } = await supabase
          .from("files")
          .select("file_id")
          .eq("user_id", user.id)
          .ilike("file_name", `%-${sanitizedName}`)
          .limit(1);
        if (existing && existing.length > 0) return fail("This photo has already been uploaded.");
      }

      const base64 = await FileSystem.readAsStringAsync(uploadUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decode(base64);

      const { data: memoryRow } = await supabase
        .from("memories")
        .insert({ user_id: user.id, source: "camera_roll", user_caption: caption.trim() || null })
        .select("memory_id")
        .single();
      if (!memoryRow) return fail("Could not create memory record.");

      const storagePath = `${user.id}/${memoryRow.memory_id}/${fileName}`;
      const cleanupMemory = () =>
        supabase.from("memories").delete().eq("memory_id", memoryRow.memory_id);

      const { error: uploadError } = await supabase.storage
        .from("memories")
        .upload(storagePath, arrayBuffer, { contentType, upsert: false });
      if (uploadError) {
        await cleanupMemory();
        return fail(`Storage upload failed: ${uploadError.message}`);
      }

      const publicUrl =
        supabase.storage.from("memories").getPublicUrl(storagePath).data.publicUrl || null;

      const { data: fileRow } = await supabase
        .from("files")
        .insert({
          user_id: user.id,
          file_name: fileName,
          storage_path: storagePath,
          public_url: publicUrl,
          original_format: "image",
          mime_type: contentType,
          byte_size: arrayBuffer.byteLength,
        })
        .select("file_id")
        .single();
      if (!fileRow) {
        await cleanupMemory();
        return fail("Could not create file record.");
      }

      const { error: updateMemoryError } = await supabase
        .from("memories")
        .update({ file_id: fileRow.file_id })
        .eq("memory_id", memoryRow.memory_id);
      if (updateMemoryError) return fail("File uploaded but memory link failed.");

      const newId = `uploaded-${memoryRow.memory_id}`;

      const cleanupAll = async () => {
        await supabase.storage.from("memories").remove([storagePath]);
        await supabase.from("files").delete().eq("file_id", fileRow.file_id);
        await cleanupMemory();
      };

      let visionText: string;
      try {
        visionText = await placeholder_extractSearchableTextFromImage(asset.uri, {
          id: newId,
          fileName,
          mimeType: contentType,
        });
      } catch (err) {
        await cleanupAll();
        return fail(`Could not generate a description for this photo: ${err instanceof Error ? err.message : "unknown error"}`);
      }

      const { error: ocrUpdateError } = await supabase.from("memories")
        .update({ ocr_description: visionText })
        .eq("memory_id", memoryRow.memory_id);
      if (ocrUpdateError) {
        await cleanupAll();
        return fail("Upload succeeded but could not save OCR description.");
      }
      setSupplementalSearchById(await upsertSupplementalSearchText(newId, visionText));
      void loadItems();
    } catch {
      fail("Could not upload this file.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletePhoto = useCallback(async () => {
    if (!selectedItem) return;
    const memoryId = selectedItem.id.replace(/^uploaded-/, "");
    setIsDeleting(true);
    try {
      const { data: memory } = await supabase
        .from("memories")
        .select("file_id")
        .eq("memory_id", memoryId)
        .single();

      if (memory?.file_id) {
        const { data: fileRecord, error: fileError } = await supabase
          .from("files")
          .select("storage_path")
          .eq("file_id", memory.file_id)
          .single();

        if (fileRecord?.storage_path) {
          await supabase.storage.from("memories").remove([fileRecord.storage_path]);
        }

        await supabase.from("files").delete().eq("file_id", memory.file_id);
      }
      await supabase.from("memories").delete().eq("memory_id", memoryId);

      const updated = await removeSupplementalSearchText(selectedItem.id);
      setSupplementalSearchById(updated);
      setItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
      setSelectedItem(null);
    } catch {
      Alert.alert("Error", "Could not delete this photo.");
    } finally {
      setIsDeleting(false);
    }
  }, [selectedItem]);

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <SafeAreaView className="flex-1 bg-[#F4F0EA]">
        <View className="flex-1">
          <View className="px-5">
            <View className="flex-row items-start justify-between gap-2 pt-1.5">
              <View className="min-w-0 flex-1 items-start gap-1">
                <Text className="text-sm font-medium text-[#5F5F5F]">Your saves</Text>
                <Text className="text-4xl font-bold tracking-[-0.5px] text-[#0B0B0B]">Library</Text>
              </View>
              <Pressable
                onPress={() => void supabase.auth.signOut()}
                className="shrink-0 rounded-full border border-[#E6E1DA] bg-white px-3 py-2 active:opacity-70"
              >
                <Text className="text-xs font-semibold uppercase tracking-wide text-[#5F5F5F]">Sign out</Text>
              </Pressable>
            </View>
            <Pressable
              className="mt-3 items-center rounded-3xl bg-[#0B0B0B] px-5 py-3.5 active:opacity-90"
              onPress={() => void handlePickImage()}
            >
              <Text className="text-base font-semibold text-white">Add to library</Text>
            </Pressable>
            <Text className="pt-3 text-sm leading-5 text-[#5F5F5F]">
              Upload screenshots, files, notes, and more.
            </Text>
            <View className="mt-4 h-12 flex-row items-center rounded-3xl border border-[#E6E1DA] bg-white px-3 shadow-sm">
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search titles, tags, categories…"
                placeholderTextColor="rgba(95, 95, 95, 0.55)"
                multiline={false}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="never"
                underlineColorAndroid="transparent"
                textContentType="none"
                autoComplete="off"
                style={[searchInputStyles.field, Platform.OS === "android" ? searchInputStyles.android : null]}
              />
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerClassName="items-start px-5 pb-8"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => {
                  setIsRefreshing(true);
                  void loadItems().finally(() => setIsRefreshing(false));
                }}
              />
            }
          >
            <Text className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#6B6B6B]">Categories</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-2"
              contentContainerClassName="flex-row gap-2 pr-1"
            >
              <Pressable
                onPress={() => setThemeFilter("all")}
                className={`rounded-full px-4 py-2 ${
                  themeFilter === "all" ? "bg-[#0B0B0B]" : "border border-[#E6E1DA] bg-white"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    themeFilter === "all" ? "text-white" : "text-[#0B0B0B]"
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
                      active ? "bg-[#0B0B0B]" : "border border-[#E6E1DA] bg-white"
                    }`}
                  >
                    <Text
                      className={`text-sm font-semibold capitalize ${
                        active ? "text-white" : "text-[#0B0B0B]"
                      }`}
                    >
                      {theme}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {gridCells.length === 0 ? (
              <Text className="mt-6 text-center text-sm text-[#5F5F5F]">
                {items.length === 0
                  ? "No uploads yet. Tap Add to library to add your first image."
                  : "Nothing matches this search or filter. Try clearing the search and choosing All."}
              </Text>
            ) : null}

            <View className="mt-5 flex-row gap-3">
              <View className="flex-1 gap-3">
                {leftColumnCells.map(({ item, highlights }) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedItem(item)}
                    className="overflow-hidden rounded-3xl border border-[#E6E1DA] bg-white shadow-sm"
                  >
                    <Image
                      source={item.source}
                      style={{ width: "100%", height: item.height }}
                      resizeMode="cover"
                    />
                    {showMatchHints && highlights.length > 0 ? (
                      <View className="border-t border-[#EFE8DF] bg-white px-2 py-1.5">
                        {highlights.slice(0, 2).map((h, idx) => (
                          <Text
                            key={`${item.id}-${h.kind}-${h.value}-${idx}`}
                            numberOfLines={1}
                            className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]"
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
                  <Pressable
                    key={item.id}
                    onPress={() => setSelectedItem(item)}
                    className="overflow-hidden rounded-3xl border border-[#E6E1DA] bg-white shadow-sm"
                  >
                    <Image
                      source={item.source}
                      style={{ width: "100%", height: item.height }}
                      resizeMode="cover"
                    />
                    {showMatchHints && highlights.length > 0 ? (
                      <View className="border-t border-[#EFE8DF] bg-white px-2 py-1.5">
                        {highlights.slice(0, 2).map((h, idx) => (
                          <Text
                            key={`${item.id}-${h.kind}-${h.value}-${idx}`}
                            numberOfLines={1}
                            className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]"
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
        </View>

        <Modal visible={!!selectedItem} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
          <Pressable className="flex-1 items-center justify-center bg-black/60" onPress={() => setSelectedItem(null)}>
            {selectedItem ? (
              <View style={{ width: "85%", height: "70%" }}>
                <Image
                  source={selectedItem.source}
                  style={{ width: "100%", height: "100%", borderRadius: 16 }}
                  resizeMode="contain"
                />
                <Pressable
                  onPress={() =>
                    Alert.alert("Delete photo", "This will permanently delete this photo.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => void handleDeletePhoto() },
                    ])
                  }
                  disabled={isDeleting}
                  style={{
                    position: "absolute",
                    top: -14,
                    right: -14,
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: "rgba(0,0,0,0.75)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "white", fontSize: 14, fontWeight: "bold", lineHeight: 18 }}>✕</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Modal>

        <Modal
          visible={!!pendingAsset}
          transparent
          animationType="slide"
          onRequestClose={() => { setPendingAsset(null); setCaptionDraft(""); }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
            <Pressable className="flex-1" onPress={() => { setPendingAsset(null); setCaptionDraft(""); }} />
            <View className="rounded-t-3xl border-t border-gray-200 bg-white px-5 pb-10 pt-5">
              {pendingAsset ? (
                <Image
                  source={{ uri: pendingAsset.uri }}
                  style={{ width: "100%", height: 120, borderRadius: 12, marginBottom: 16 }}
                  resizeMode="cover"
                />
              ) : null}
              <Text className="mb-2 text-base font-black text-black">Add a caption</Text>
              <View className="mb-4 rounded-2xl border border-gray-200 px-4 py-3">
                <TextInput
                  value={captionDraft}
                  onChangeText={setCaptionDraft}
                  placeholder="Optional — describe what this is…"
                  placeholderTextColor="#9CA3AF"
                  className="text-base text-black"
                  multiline
                  numberOfLines={3}
                  autoFocus
                />
              </View>
              <View className="flex-row gap-3">
                <Pressable
                  onPress={() => { setPendingAsset(null); setCaptionDraft(""); }}
                  className="flex-1 items-center rounded-2xl border border-gray-200 py-4 active:opacity-70"
                >
                  <Text className="text-base font-black text-gray-700">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleConfirmUpload(captionDraft)}
                  disabled={isUploading}
                  className="flex-1 items-center rounded-2xl bg-blue-500 py-4 active:opacity-70"
                >
                  <Text className="text-base font-black text-white">
                    {isUploading ? "Uploading…" : "Upload"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
