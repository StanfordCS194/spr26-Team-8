import type { ArchiveItemMeta } from "@/lib/archiveSearchAndCluster";
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
import { checkImageContext, moderateUpload } from "@/lib/moderation";
import {
  placeholder_extractSearchableTextFromImage,
  placeholder_fetchEmbeddingThemeOverrides,
  placeholder_fetchRemoteArchiveMeta,
  placeholder_notifyArchiveIndexUpdated,
} from "@/lib/teamIntegrationPlaceholders";
import { posthog } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { useFocusEffect } from "@react-navigation/native";
import { decode } from "base64-arraybuffer";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  type AppStateStatus,
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const imageHeights = [220, 280, 200, 260];

type BoardItem = {
  id: string;
  source: ImageSourcePropType;
  height: number;
};

type GridCell = {
  item: BoardItem;
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
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountMenuAnchor, setAccountMenuAnchor] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const settingsButtonRef = useRef<View | null>(null);
  const insets = useSafeAreaInsets();
  const ACCOUNT_MENU_W = 208;

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

    /** Shorter than 1h caused images to “disappear” (blank) after the URL expired. */
    const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;
    const { data: signed } = await supabase.storage
      .from("memories")
      .createSignedUrls(entries.map((e) => e.storage_path), SIGNED_URL_TTL_SEC);

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
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void loadItems();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [loadItems]);

  /** Refresh file URLs and DB state when returning to this tab (signed URLs are time-limited). */
  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems])
  );

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void loadItems();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
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
        return { item };
      })
      .filter((cell): cell is GridCell => Boolean(cell));
  }, [searchResults, itemsById]);

  const leftColumnCells = gridCells.filter((_, index) => index % 2 === 0);
  const rightColumnCells = gridCells.filter((_, index) => index % 2 === 1);

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

      const moderation = await moderateUpload({
        base64,
        mimeType: contentType,
        caption: caption.trim() || undefined,
      });
      if (!moderation.allowed) {
        return fail(`This upload was blocked by content moderation (${moderation.reason}).`);
      }

      const context = await checkImageContext({
        base64,
        mimeType: contentType,
      });
      if (!context.ok) {
        return fail(`This image doesn't look like a memory worth saving (${context.reason}). Try another photo.`);
      }

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
      posthog.capture("photo_uploaded");
      void loadItems();
    } catch {
      fail("Could not upload this file.");
    } finally {
      setIsUploading(false);
    }
  };

  const performDeleteItem = useCallback(async (itemId: string) => {
    const memoryId = itemId.replace(/^uploaded-/, "");
    const { data: memory } = await supabase
      .from("memories")
      .select("file_id")
      .eq("memory_id", memoryId)
      .single();

    if (memory?.file_id) {
      const { data: fileRecord } = await supabase
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

    const updated = await removeSupplementalSearchText(itemId);
    setSupplementalSearchById(updated);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setSelectedItem((cur) => (cur?.id === itemId ? null : cur));
    setBulkSelectedIds((ids) => ids.filter((x) => x !== itemId));
  }, []);

  const handleDeletePhoto = useCallback(async () => {
    if (!selectedItem) return;
    setIsDeleting(true);
    try {
      await performDeleteItem(selectedItem.id);
    } catch {
      Alert.alert("Error", "Could not delete this photo.");
    } finally {
      setIsDeleting(false);
    }
  }, [selectedItem, performDeleteItem]);

  const closeAccountMenu = useCallback(() => {
    setAccountMenuOpen(false);
    setAccountMenuAnchor(null);
  }, []);

  const openSettingsMenu = useCallback(() => {
    settingsButtonRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) {
        setAccountMenuAnchor({ x, y, w, h });
      } else {
        setAccountMenuAnchor({
          x: windowWidth - 16 - 40,
          y: insets.top + 8,
          w: 40,
          h: 40,
        });
      }
      setAccountMenuOpen(true);
    });
  }, [insets.top, windowWidth]);

  const clearSelection = useCallback(() => {
    setIsSelecting(false);
    setBulkSelectedIds([]);
    closeAccountMenu();
  }, [closeAccountMenu]);

  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (bulkSelectedIds.length === 0) return;
    const n = bulkSelectedIds.length;
    Alert.alert("Delete photos", `Delete ${n} ${n === 1 ? "photo" : "photos"}? This can’t be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setIsBulkDeleting(true);
            const ids = [...bulkSelectedIds];
            try {
              for (const id of ids) {
                await performDeleteItem(id);
              }
              clearSelection();
            } catch {
              Alert.alert("Error", "Some photos could not be deleted. Try again.");
            } finally {
              setIsBulkDeleting(false);
            }
          })();
        },
      },
    ]);
  }, [bulkSelectedIds, performDeleteItem, clearSelection]);

  const enterSelectMode = useCallback(() => {
    setSelectedItem(null);
    closeAccountMenu();
    setIsSelecting(true);
  }, [closeAccountMenu]);

  const allVisibleSelected =
    gridCells.length > 0 && gridCells.every((c) => bulkSelectedIds.includes(c.item.id));

  const handleSelectOrDeselectAllVisible = useCallback(() => {
    if (allVisibleSelected) {
      setBulkSelectedIds([]);
    } else {
      setBulkSelectedIds(gridCells.map((c) => c.item.id));
    }
  }, [allVisibleSelected, gridCells]);

  const renderOneCell = ({ item }: GridCell) => {
    const selected = bulkSelectedIds.includes(item.id);
    return (
      <Pressable
        key={item.id}
        onPress={() => (isSelecting ? toggleBulkSelect(item.id) : setSelectedItem(item))}
        onLongPress={() => {
          if (!isSelecting) {
            setIsSelecting(true);
            setBulkSelectedIds([item.id]);
          }
        }}
        className={`overflow-hidden rounded-3xl bg-white shadow-sm ${
          isSelecting && selected ? "border-2 border-[#0B7AEE]" : "border border-[#E6E1DA]"
        } ${isSelecting && !selected ? "opacity-90" : ""}`}
      >
        <View className="relative">
          <Image
            source={item.source}
            style={{ width: "100%", height: item.height }}
            resizeMode="cover"
          />
          {isSelecting ? (
            <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-black/35">
              {selected ? (
                <Ionicons name="checkmark" size={18} color="#fff" />
              ) : (
                <View className="h-3.5 w-3.5 rounded-full border-2 border-white" />
              )}
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const accountPopoverPos = useMemo(() => {
    if (!accountMenuAnchor) return null;
    const GAP = 6;
    const pad = 16;
    const top = accountMenuAnchor.y + accountMenuAnchor.h + GAP;
    const rawLeft = accountMenuAnchor.x + accountMenuAnchor.w - ACCOUNT_MENU_W;
    const left = Math.max(pad, Math.min(rawLeft, windowWidth - ACCOUNT_MENU_W - pad));
    return { left, top };
  }, [ACCOUNT_MENU_W, accountMenuAnchor, windowWidth]);

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <SafeAreaView className="flex-1 bg-[#F4F0EA]" edges={["top", "left", "right"]}>
        <View className="flex-1">
          <View className="px-5">
            <View className="pt-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-[#5F5F5F]">Your saves</Text>
                {!isSelecting ? (
                  <View ref={settingsButtonRef} collapsable={false} className="rounded-full">
                    <Pressable
                      accessibilityLabel="Account and settings"
                      onPress={openSettingsMenu}
                      hitSlop={8}
                      className="rounded-full p-1.5 active:bg-black/5"
                    >
                      <Ionicons name="settings-outline" size={24} color="#2C2C2C" />
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View className="mt-1">
                <Text className="text-4xl font-bold tracking-[-0.5px] text-[#0B0B0B]">Library</Text>
                {isSelecting ? (
                  <Text className="pt-0.5 text-sm font-medium text-[#0B7AEE]">
                    {bulkSelectedIds.length} selected
                  </Text>
                ) : null}
              </View>
            </View>
            <Pressable
              disabled={isSelecting}
              className={`mt-3 items-center rounded-3xl px-5 py-3.5 ${
                isSelecting ? "bg-[#0B0B0B]/35" : "bg-[#0B0B0B] active:opacity-90"
              }`}
              onPress={() => void handlePickImage()}
            >
              <Text className="text-base font-semibold text-white">Add to library</Text>
            </Pressable>
            <Text
              className={`pt-3 text-sm leading-5 text-[#5F5F5F] ${isSelecting ? "opacity-40" : ""}`}
            >
              Upload screenshots, files, notes, and more.
            </Text>
            <View
              className={`mt-4 h-12 flex-row items-center rounded-3xl border border-[#E6E1DA] bg-white px-3 shadow-sm ${
                isSelecting ? "opacity-40" : ""
              }`}
            >
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                editable={!isSelecting}
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
            contentContainerClassName="items-start px-5"
            contentContainerStyle={{
              paddingBottom: 32 + (isSelecting ? 0 : insets.bottom),
            }}
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
            <Text className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-[#6B6B6B]">Categories</Text>
            <View className="mt-2.5 flex-row items-center gap-2">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="min-w-0 flex-1"
                contentContainerClassName="flex-row flex-nowrap items-center gap-2 pr-1"
                pointerEvents={isSelecting ? "none" : "auto"}
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
              {isSelecting || gridCells.length > 0 ? (
                <Pressable
                  onPress={isSelecting ? clearSelection : enterSelectMode}
                  accessibilityLabel={isSelecting ? "Cancel selection" : "Select photos"}
                  className="h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#DED9D0] bg-white shadow-sm active:bg-[#F0EBE2]"
                >
                  <Ionicons
                    name={isSelecting ? "close" : "checkmark-circle-outline"}
                    size={isSelecting ? 22 : 20}
                    color={isSelecting ? "#5C534A" : "#1A1A1A"}
                  />
                </Pressable>
              ) : null}
            </View>

            {gridCells.length === 0 ? (
              <View className="mt-6 items-center">
                <Text className="text-center text-sm text-[#5F5F5F]">
                  {items.length === 0
                    ? "No uploads yet. Tap Add to library to add your first image."
                    : "Nothing matches this search or filter. New uploads are often under “All” and “life” until tags catch up — or your search is hiding them."}
                </Text>
                {items.length > 0 && (searchQuery.trim().length > 0 || themeFilter !== "all") ? (
                  <Pressable
                    onPress={() => {
                      setSearchQuery("");
                      setThemeFilter("all");
                    }}
                    className="mt-3 rounded-full border border-[#DED9D0] bg-white px-4 py-2 active:bg-[#F0EBE2]"
                  >
                    <Text className="text-sm font-semibold text-[#0B0B0B]">Show all photos</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View className="mt-5 flex-row gap-3">
              <View className="flex-1 gap-3">{leftColumnCells.map((cell) => renderOneCell(cell))}</View>
              <View className="flex-1 gap-3">{rightColumnCells.map((cell) => renderOneCell(cell))}</View>
            </View>
          </ScrollView>
        </View>

        {isSelecting ? (
          <View
            className="border-t border-[#E6E1DA] bg-white px-5 pt-3"
            style={{ paddingBottom: 12 + insets.bottom }}
          >
            <View className="flex-row items-center justify-between gap-3">
              <Pressable
                onPress={handleSelectOrDeselectAllVisible}
                className="rounded-xl py-2 active:opacity-70"
                disabled={gridCells.length === 0}
              >
                <Text className="text-base font-semibold text-[#0B7AEE]">
                  {allVisibleSelected ? "Deselect all" : "Select all"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleBulkDelete}
                disabled={bulkSelectedIds.length === 0 || isBulkDeleting}
                className="rounded-2xl bg-red-500 px-5 py-2.5 active:opacity-80 disabled:opacity-40"
              >
                <Text className="text-base font-semibold text-white">
                  {isBulkDeleting
                    ? "Deleting…"
                    : bulkSelectedIds.length > 0
                      ? `Delete (${bulkSelectedIds.length})`
                      : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <Modal visible={!!selectedItem} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
          <View className="flex-1">
            <Pressable
              accessibilityLabel="Close image"
              onPress={() => setSelectedItem(null)}
              className="absolute inset-0 bg-black/60"
            />
            <View className="absolute inset-0 items-center justify-center" pointerEvents="box-none">
              {selectedItem ? (
                <View
                  className="overflow-hidden rounded-2xl bg-black"
                  style={{ width: "85%", height: "70%" }}
                >
                  <View className="flex-1">
                    <Image
                      source={selectedItem.source}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="contain"
                    />
                    <Pressable
                      accessibilityLabel="Close"
                      onPress={() => setSelectedItem(null)}
                      className="absolute left-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-black/50 active:opacity-80"
                    >
                      <Text className="text-base font-bold leading-none text-white">×</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Delete photo"
                      disabled={isDeleting}
                      onPress={() =>
                        Alert.alert("Delete photo", "This will permanently delete this photo.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => void handleDeletePhoto() },
                        ])
                      }
                      className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-black/50 active:opacity-80 disabled:opacity-40"
                    >
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </Modal>

        <Modal
          visible={accountMenuOpen}
          transparent
          animationType="fade"
          onRequestClose={closeAccountMenu}
        >
          <View className="flex-1">
            <Pressable
              className="absolute inset-0 bg-black/20"
              onPress={closeAccountMenu}
              accessibilityLabel="Close menu"
            />
            {accountMenuAnchor && accountPopoverPos ? (
              <View className="absolute inset-0" pointerEvents="box-none">
                <View
                  className="overflow-hidden rounded-2xl border border-[#E6E1DA] bg-white"
                  style={[
                    {
                      left: accountPopoverPos.left,
                      position: "absolute",
                      top: accountPopoverPos.top,
                      width: ACCOUNT_MENU_W,
                      zIndex: 2,
                    },
                    Platform.select({
                      android: { elevation: 10 },
                      ios: {
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 6 },
                        shadowOpacity: 0.2,
                        shadowRadius: 12,
                      },
                    }),
                  ]}
                >
                  <Text className="border-b border-[#E6E1DA] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#6B6B6B]">
                    Account
                  </Text>
                  <Pressable
                    className="px-3 py-2.5 active:bg-[#F4F0EA]"
                    onPress={() => {
                      closeAccountMenu();
                      void supabase.auth.signOut();
                    }}
                    accessibilityLabel="Sign out"
                  >
                    <Text className="text-sm font-semibold text-red-500">Sign out</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
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
              <View className="mb-4 rounded-2xl border border-gray-200 px-4 pb-3 pt-2">
                <TextInput
                  value={captionDraft}
                  onChangeText={setCaptionDraft}
                  placeholder="Optional — describe what this is…"
                  placeholderTextColor="#9CA3AF"
                  className="text-base text-black"
                  multiline
                  numberOfLines={3}
                  autoFocus
                  textAlignVertical="top"
                  style={{
                    minHeight: 80,
                    paddingTop: 0,
                    paddingBottom: 0,
                    lineHeight: 22,
                    fontSize: 16,
                    color: "#0B0B0B",
                  }}
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
