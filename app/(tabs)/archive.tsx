import type { ArchiveItemMeta } from "@/lib/archiveSearchAndCluster";
import {
  archiveIndexForBackend,
  enrichArchiveRows,
  hydrateArchiveMeta,
  mergeArchiveMeta,
  searchAndRankArchiveRows,
} from "@/lib/archiveSearchAndCluster";
import {
  loadSupplementalSearchText,
  mergeSupplementalStrings,
  removeSupplementalSearchText,
  upsertSupplementalSearchText,
} from "@/lib/archiveSupplementalSearchText";
import { extractTextTemporalSignals } from "@/lib/extractTemporalFromUserText";
import { checkImageContext, moderateUpload } from "@/lib/moderation";
import { fetchRemoteArchiveMeta, notifyArchiveIndexUpdated } from "@/lib/archiveBackendSync";
import { fetchEmbeddingThemeOverrides } from "@/lib/embeddingThemes";
import { MiniChatWindow } from "@/components/MiniChatWindow";
import { getWeeklyNudgeEnabled, setWeeklyNudgeEnabled } from "@/lib/nudgePrefs";
import { extractSearchableTextFromImage } from "@/lib/vision";
import { posthog } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { isUndefinedColumnError } from "@/lib/supabaseSchema";
import {
  type CachedSignedUrl,
  clearSignedUrlCache,
  loadSignedUrlCache,
  saveSignedUrlCache,
} from "@/lib/archiveSignedUrlCache";
import { useFocusEffect } from "@react-navigation/native";
import { decode } from "base64-arraybuffer";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
// using expo-image so photos actually cache on disk between launches
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useIncomingShare } from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const imageHeights = [220, 280, 200, 260];

type BoardItem = {
  id: string;
  // always a Supabase signed URL
  source: { uri: string };
  height: number;
  /** From `files.file_name` — used for tag/theme inference and keyword search (not raw memory UUID). */
  searchFileName: string;
  /** From `memories.ocr_description` + `user_caption`; merged with local supplemental OCR cache. */
  serverSearchText: string;
  /** `memories.user_caption` — shown and editable in the viewer. */
  userCaption: string | null;
  /** Rebuild `serverSearchText` after caption edits. */
  wantToDo: string;
  ocrDescription: string;
};

type GridCell = {
  item: BoardItem;
};

type MemoryFileRow = {
  memory_id: string;
  want_to_do?: string | null;
  ocr_description: string | null;
  user_caption: string | null;
  files:
    | { storage_path: string; file_name: string }
    | { storage_path: string; file_name: string }[]
    | null;
};

type UploadAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  // dimensions only come through the image picker, not the share sheet
  width?: number | null;
  height?: number | null;
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

function normalizeSingleParam(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default function ArchiveTab() {
  const archiveParams = useLocalSearchParams<{ openMemoryId?: string | string[] }>();
  const pendingOpenMemoryId = normalizeSingleParam(archiveParams.openMemoryId)?.trim();
  const [items, setItems] = useState<BoardItem[]>([]);
  const [archiveLoadGeneration, setArchiveLoadGeneration] = useState(0);
  const [meta, setMeta] = useState<Record<string, ArchiveItemMeta>>({});
  const [themeOverrides, setThemeOverrides] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [supplementalSearchById, setSupplementalSearchById] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null);
  const [pendingAsset, setPendingAsset] = useState<UploadAsset | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [intentDraft, setIntentDraft] = useState("");
  const [weeklyNudgeEnabled, setWeeklyNudgeEnabledState] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingCaption, setIsSavingCaption] = useState(false);
  const [viewerCaptionDraft, setViewerCaptionDraft] = useState("");
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const settingsButtonRef = useRef<View | null>(null);
  const insets = useSafeAreaInsets();
  const ACCOUNT_MENU_W = 208;
  const { resolvedSharedPayloads, clearSharedPayloads, error: shareError, refreshSharePayloads } =
    useIncomingShare();

  // hold onto signed URLs so the URL string stays the same across reloads. that's what lets the disk cache hit
  const signedUrlCacheRef = useRef<Map<string, CachedSignedUrl>>(new Map());
  // remember which user this cache belongs to, so we re-hydrate from disk when the user changes
  const cachedUserIdRef = useRef<string | null>(null);
  // when we last loaded. used to skip redundant reloads
  const lastLoadAtRef = useRef<number>(0);

  useEffect(() => {
    void loadSupplementalSearchText().then(setSupplementalSearchById);
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    void getWeeklyNudgeEnabled().then(setWeeklyNudgeEnabledState);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (shareError) {
      Alert.alert("Share", "Could not read incoming shared content.");
    }
  }, [shareError]);

  useEffect(() => {
    if (!resolvedSharedPayloads.length) return;

    const sharedImageUris = resolvedSharedPayloads
      .filter((payload) => payload.contentType === "image" && payload.contentUri)
      .map((payload) => payload.contentUri)
      .filter((uri): uri is string => typeof uri === "string");

    if (!sharedImageUris.length) return;

    const uri = sharedImageUris[0];
    clearSharedPayloads();
    void refreshSharePayloads();

    setPendingAsset({
      uri,
      fileName: uri.split("/").pop() ?? `shared-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
    });
    setCaptionDraft("");
    setIntentDraft("");
  }, [clearSharedPayloads, refreshSharePayloads, resolvedSharedPayloads]);

  const loadItems = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setItems([]);
        return;
      }

      // first time we see this user this session, pull their saved URL cache off disk so cold starts can hit the cache
      if (cachedUserIdRef.current !== user.id) {
        signedUrlCacheRef.current = await loadSignedUrlCache(user.id);
        cachedUserIdRef.current = user.id;
      }

      const SEL_FULL =
        "memory_id, want_to_do, ocr_description, user_caption, files(storage_path, file_name)";
      const SEL_LEGACY =
        "memory_id, ocr_description, user_caption, files(storage_path, file_name)";

      const fullRes = await supabase
        .from("memories")
        .select(SEL_FULL)
        .eq("user_id", user.id)
        .not("file_id", "is", null)
        .order("memory_id", { ascending: true });

      const rowsRes =
        fullRes.error && isUndefinedColumnError(fullRes.error, "want_to_do")
          ? await supabase
              .from("memories")
              .select(SEL_LEGACY)
              .eq("user_id", user.id)
              .not("file_id", "is", null)
              .order("memory_id", { ascending: true })
          : fullRes;

      if (rowsRes.error) {
        if (__DEV__) console.warn("[archive] memories load:", rowsRes.error.message);
        setItems([]);
        return;
      }

      const data = rowsRes.data;

      const entries = ((data as MemoryFileRow[] | null) ?? []).flatMap((m) => {
        const file = Array.isArray(m.files) ? m.files[0] : m.files;
        if (!file) return [];
        const want = m.want_to_do?.trim() ?? "";
        const ocr = m.ocr_description?.trim() ?? "";
        const cap = m.user_caption?.trim() ?? "";
        const serverSearchText = [want, ocr, cap].filter(Boolean).join(" ");
        return [
          {
            memory_id: m.memory_id,
            storage_path: file.storage_path,
            searchFileName: file.file_name,
            serverSearchText,
            userCaption: cap.length > 0 ? cap : null,
            wantToDo: want,
            ocrDescription: ocr,
          },
        ];
      });
      if (entries.length === 0) {
        setItems([]);
        return;
      }

      // long TTL. anything shorter and images vanish when the URL expires mid-session
      const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;
      // only refresh URLs that are about to expire. keeps strings stable so the cache hits
      const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

      const now = Date.now();
      const pathsNeedingSignedUrl: string[] = [];
      for (const e of entries) {
        const cached = signedUrlCacheRef.current.get(e.storage_path);
        if (!cached || cached.expiresAt - now < REFRESH_THRESHOLD_MS) {
          pathsNeedingSignedUrl.push(e.storage_path);
        }
      }

      let cacheChanged = false;
      if (pathsNeedingSignedUrl.length > 0) {
        const { data: signed } = await supabase.storage
          .from("memories")
          .createSignedUrls(pathsNeedingSignedUrl, SIGNED_URL_TTL_SEC);
        const expiresAt = now + SIGNED_URL_TTL_SEC * 1000;
        for (const s of signed ?? []) {
          if (s.signedUrl && s.path) {
            signedUrlCacheRef.current.set(s.path, { url: s.signedUrl, expiresAt });
            cacheChanged = true;
          }
        }
      }

      setItems(
        entries.flatMap((e, i) => {
          const cached = signedUrlCacheRef.current.get(e.storage_path);
          if (!cached) return [];
          return [
            {
              id: `uploaded-${e.memory_id}`,
              source: { uri: cached.url },
              height: imageHeights[i % imageHeights.length],
              searchFileName: e.searchFileName,
              serverSearchText: e.serverSearchText,
              userCaption: e.userCaption,
              wantToDo: e.wantToDo,
              ocrDescription: e.ocrDescription,
            },
          ];
        })
      );

      // persist new URLs to disk so the next cold start can reuse them
      if (cacheChanged) void saveSignedUrlCache(user.id, signedUrlCacheRef.current);
    } finally {
      setArchiveLoadGeneration((g) => g + 1);
    }
  }, []);

  // skip the reload if we just did one. pass force=true to override (pull-to-refresh, sign-in)
  const loadItemsIfStale = useCallback(
    async (opts?: { force?: boolean }) => {
      const STALE_MS = 5 * 60 * 1000;
      const now = Date.now();
      if (!opts?.force && lastLoadAtRef.current && now - lastLoadAtRef.current < STALE_MS) {
        return;
      }
      // claim early so two simultaneous calls don't both run
      lastLoadAtRef.current = now;
      await loadItems();
    },
    [loadItems]
  );

  useEffect(() => {
    // ignore USER_UPDATED, it fires on every token refresh and was eating egress
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        // wipe the cache so we don't leak the previous user's signed URLs
        const previousUserId = cachedUserIdRef.current;
        signedUrlCacheRef.current.clear();
        cachedUserIdRef.current = null;
        lastLoadAtRef.current = 0;
        if (previousUserId) void clearSignedUrlCache(previousUserId);
        void loadItemsIfStale({ force: true });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [loadItemsIfStale]);

  // reload when the tab gets focus, but only if we haven't loaded recently
  useFocusEffect(
    useCallback(() => {
      void loadItemsIfStale();
    }, [loadItemsIfStale])
  );

  useEffect(() => {
    if (!pendingOpenMemoryId) return;
    if (archiveLoadGeneration === 0) return;
    const targetId = `uploaded-${pendingOpenMemoryId}`;
    const item = items.find((i) => i.id === targetId);
    if (item) setSelectedItem(item);
    router.setParams({ openMemoryId: undefined });
  }, [pendingOpenMemoryId, items, archiveLoadGeneration]);

  useEffect(() => {
    if (!selectedItem?.id) {
      setViewerCaptionDraft("");
      return;
    }
    setViewerCaptionDraft(selectedItem.userCaption ?? "");
  }, [selectedItem?.id, selectedItem?.userCaption]);

  // no AppState listener. used to re-download every photo on every app foreground

  useEffect(() => {
    const ids = items.map((item) => ({
      id: item.id,
      fileName: item.searchFileName,
    }));

    let cancelled = false;
    void (async () => {
      const local = await hydrateArchiveMeta(ids);
      const remote = await fetchRemoteArchiveMeta(ids);
      const merged = mergeArchiveMeta(local, remote);
      if (!cancelled) setMeta(merged);

      const embeddingThemes = await fetchEmbeddingThemeOverrides(ids);
      if (!cancelled) setThemeOverrides(embeddingThemes);
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const indexRows = useMemo(() => {
    const fileNameById = Object.fromEntries(items.map((b) => [b.id, b.searchFileName]));
    const searchableTextById: Record<string, string> = { ...supplementalSearchById };
    for (const item of items) {
      const server = item.serverSearchText.trim();
      if (!server) continue;
      searchableTextById[item.id] = mergeSupplementalStrings(searchableTextById[item.id], server);
    }
    return enrichArchiveRows(items.map((b) => b.id), meta, {
      themeOverrides,
      fileNameById,
      searchableTextById,
    });
  }, [items, meta, themeOverrides, supplementalSearchById]);

  const indexPayload = useMemo(() => archiveIndexForBackend(indexRows), [indexRows]);

  useEffect(() => {
    void notifyArchiveIndexUpdated(indexPayload);
  }, [indexPayload]);

  const searchResults = useMemo(
    () => searchAndRankArchiveRows(indexRows, searchQuery, "all"),
    [indexRows, searchQuery]
  );

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
      const selected = picked.assets[0];
      setPendingAsset({
        uri: selected.uri,
        fileName: selected.fileName,
        mimeType: selected.mimeType,
        width: selected.width,
        height: selected.height,
      });
    } catch {
      fail("Could not open photo library.");
    }
  };

  const handleConfirmUpload = async (caption: string) => {
    if (!pendingAsset) return;
    const asset = pendingAsset;
    const wantToDoSaved = intentDraft.trim();
    setPendingAsset(null);
    setCaptionDraft("");
    setIntentDraft("");
    setIsUploading(true);

    const fail = (msg: string) => Alert.alert("Upload", msg);
    try {
      const rawName = asset.fileName || asset.uri.split("/").pop() || `upload-${Date.now()}.jpg`;
      const sanitizedBaseName = rawName
        .replace(/[^\w.\-]/g, "_")
        .replace(/\.(heic|heif|png|jpg|jpeg)$/i, "");
      const wasJpeg = isJpegAsset(asset.mimeType, rawName);
      // keep the original extension when we can so dedup against older uploads still matches
      const fileName = wasJpeg
        ? `${Date.now()}-${rawName.replace(/[^\w.\-]/g, "_")}`
        : `${Date.now()}-${sanitizedBaseName}.jpeg`;
      const contentType = "image/jpeg";

      // shrink huge phone photos and recompress so we're not storing 4MB JPEGs
      const TARGET_LONGEST_PX = 1920;
      const longestDim = Math.max(asset.width || 0, asset.height || 0);
      const actions: ImageManipulator.Action[] = [];
      if (asset.width && asset.height && longestDim > TARGET_LONGEST_PX) {
        // scale so the longest side is TARGET_LONGEST_PX, aspect ratio preserved
        const scale = TARGET_LONGEST_PX / longestDim;
        actions.push({
          resize: {
            width: Math.round(asset.width * scale),
            height: Math.round(asset.height * scale),
          },
        });
      }
      const processed = await ImageManipulator.manipulateAsync(
        asset.uri,
        actions,
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      const uploadUri = processed.uri;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return fail("Could not identify the current user.");

      // skip the upload entirely if we've already got this filename for this user
      if (asset.fileName) {
        const sanitizedName = wasJpeg
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

      const moderationCaption = [caption.trim(), wantToDoSaved].filter(Boolean).join("\n\n");
      const moderation = await moderateUpload({
        base64,
        mimeType: contentType,
        caption: moderationCaption || undefined,
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

      const textTemporalPayload = extractTextTemporalSignals({
        caption: caption.trim(),
        want_to_do: wantToDoSaved || "",
      });

      const insertMinimal = async () =>
        await supabase
          .from("memories")
          .insert({
            user_id: user.id,
            source: "camera_roll",
            user_caption: caption.trim() || null,
          })
          .select("memory_id")
          .single();

      const insertWithTemporal = async () =>
        await supabase
          .from("memories")
          .insert({
            user_id: user.id,
            source: "camera_roll",
            user_caption: caption.trim() || null,
            text_temporal: textTemporalPayload,
          })
          .select("memory_id")
          .single();

      let temporalSavedOnInsert = false;
      let ins = await insertWithTemporal();
      if (ins.error && isUndefinedColumnError(ins.error, "text_temporal")) {
        ins = await insertMinimal();
      } else if (!ins.error) {
        temporalSavedOnInsert = true;
      }

      const memoryRow = ins.data;
      const insertMemErr = ins.error;
      if (insertMemErr || !memoryRow) {
        return fail(insertMemErr?.message ?? "Could not create memory record.");
      }

      if (wantToDoSaved) {
        const { error: intentErr } = await supabase
          .from("memories")
          .update({ want_to_do: wantToDoSaved })
          .eq("memory_id", memoryRow.memory_id);
        if (__DEV__ && intentErr && !isUndefinedColumnError(intentErr, "want_to_do")) {
          console.warn("[archive] could not save want_to_do:", intentErr.message);
        }
      }

      if (!temporalSavedOnInsert) {
        const { error: temporalErr } = await supabase
          .from("memories")
          .update({ text_temporal: textTemporalPayload })
          .eq("memory_id", memoryRow.memory_id);
        if (__DEV__ && temporalErr && !isUndefinedColumnError(temporalErr, "text_temporal")) {
          console.warn("[archive] could not save text_temporal:", temporalErr.message);
        }
      }

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
        visionText = await extractSearchableTextFromImage(asset.uri, {
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
    const { data: memory, error: memoryLookupErr } = await supabase
      .from("memories")
      .select("file_id")
      .eq("memory_id", memoryId)
      .single();

    if (memoryLookupErr) throw memoryLookupErr;
    if (!memory) throw new Error("Photo not found.");

    if (memory.file_id) {
      const { data: fileRecord, error: fileErr } = await supabase
        .from("files")
        .select("storage_path")
        .eq("file_id", memory.file_id)
        .single();

      if (fileErr) throw fileErr;

      if (fileRecord?.storage_path) {
        const { error: storageErr } = await supabase.storage
          .from("memories")
          .remove([fileRecord.storage_path]);
        if (storageErr) throw storageErr;
      }

      const { error: delFileErr } = await supabase.from("files").delete().eq("file_id", memory.file_id);
      if (delFileErr) throw delFileErr;
    }

    const { error: delMemoryErr } = await supabase.from("memories").delete().eq("memory_id", memoryId);
    if (delMemoryErr) throw delMemoryErr;

    const updated = await removeSupplementalSearchText(itemId);
    setSupplementalSearchById(updated);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setSelectedItem((cur) => (cur?.id === itemId ? null : cur));
    setBulkSelectedIds((ids) => ids.filter((x) => x !== itemId));
  }, []);

  const handleDeletePhotoById = useCallback(async (itemId: string) => {
    setIsDeleting(true);
    try {
      await performDeleteItem(itemId);
    } catch {
      Alert.alert("Error", "Could not delete this photo.");
    } finally {
      setIsDeleting(false);
    }
  }, [performDeleteItem]);

  const handleSaveViewerCaption = useCallback(async () => {
    if (!selectedItem) return;
    const memoryId = selectedItem.id.replace(/^uploaded-/, "");
    const trimmed = viewerCaptionDraft.trim();
    const newCaption = trimmed.length > 0 ? trimmed : null;
    const prevTrimmed = (selectedItem.userCaption ?? "").trim();
    if (trimmed === prevTrimmed) return;

    setIsSavingCaption(true);
    try {
      const { error } = await supabase
        .from("memories")
        .update({ user_caption: newCaption })
        .eq("memory_id", memoryId);
      if (error) {
        Alert.alert("Could not save", error.message);
        return;
      }
      const want = selectedItem.wantToDo;
      const ocr = selectedItem.ocrDescription;
      const serverSearchText = [want, ocr, trimmed].filter(Boolean).join(" ");
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedItem.id
            ? { ...i, userCaption: newCaption, serverSearchText }
            : i
        )
      );
      setSelectedItem((cur) =>
        cur && cur.id === selectedItem.id
          ? { ...cur, userCaption: newCaption, serverSearchText }
          : cur
      );
    } catch {
      Alert.alert("Could not save", "Something went wrong. Try again.");
    } finally {
      setIsSavingCaption(false);
    }
  }, [selectedItem, viewerCaptionDraft]);

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
            contentFit="cover"
            // keep in RAM for the session and on disk between launches
            cachePolicy="memory-disk"
            transition={150}
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

  const viewerImageMaxH = Math.min(320, Math.round(windowHeight * 0.4));
  const viewerCaptionDirty =
    Boolean(selectedItem) &&
    viewerCaptionDraft.trim() !== (selectedItem?.userCaption ?? "").trim();

  return (
    <View className="flex-1 bg-[#F4F0EA]">
      <SafeAreaView className="flex-1 bg-[#F4F0EA]" edges={["left", "right"]}>
        <View className="flex-1">
          <View className="px-5">
            <View className="pt-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-[#5F5F5F]">Your saves</Text>
                {!isSelecting ? (
                  <View className="flex-row items-center gap-1">
                    <MiniChatWindow />
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
              className={`mt-4 mb-4 h-12 flex-row items-center rounded-3xl border border-[#E6E1DA] bg-white px-3 shadow-sm ${
                isSelecting ? "opacity-40" : ""
              }`}
            >
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                editable={!isSelecting}
                placeholder="Search titles, tags…"
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
                  // pull-to-refresh, always actually refetch
                  void loadItemsIfStale({ force: true }).finally(() =>
                    setIsRefreshing(false)
                  );
                }}
              />
            }
          >
            <View className="mt-4 flex-row justify-end">
              {isSelecting || gridCells.length > 0 ? (
                <Pressable
                  onPress={isSelecting ? clearSelection : enterSelectMode}
                  accessibilityLabel={isSelecting ? "Cancel" : "Select"}
                  accessibilityHint={
                    isSelecting ? "Stop choosing photos to delete" : "Choose photos to delete or manage"
                  }
                  className="shrink-0 flex-row items-center gap-2 rounded-full border border-[#DED9D0] bg-white px-3.5 py-2 shadow-sm active:bg-[#F0EBE2]"
                >
                  <Ionicons
                    name={isSelecting ? "close" : "images-outline"}
                    size={isSelecting ? 20 : 19}
                    color={isSelecting ? "#5C534A" : "#1A1A1A"}
                  />
                  <Text className="text-sm font-semibold text-[#0B0B0B]">
                    {isSelecting ? "Cancel" : "Select"}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {gridCells.length === 0 ? (
              <View className="mt-6 items-center">
                <Text className="text-center text-sm text-[#5F5F5F]">
                  {items.length === 0
                    ? "No uploads yet. Tap Add to library to add your first image."
                    : "Nothing matches this search. Try different words — or wait for tags to update on new uploads."}
                </Text>
                {items.length > 0 && searchQuery.trim().length > 0 ? (
                  <Pressable
                    onPress={() => setSearchQuery("")}
                    className="mt-3 rounded-full border border-[#DED9D0] bg-white px-4 py-2 active:bg-[#F0EBE2]"
                  >
                    <Text className="text-sm font-semibold text-[#0B0B0B]">Clear search</Text>
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

        <Modal
          visible={!!selectedItem}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!isSavingCaption) setSelectedItem(null);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1"
          >
            <View className="flex-1 justify-center px-4">
              <Pressable
                accessibilityLabel="Close image"
                disabled={isSavingCaption}
                onPress={() => {
                  if (!isSavingCaption) setSelectedItem(null);
                }}
                className="absolute inset-0 z-0 bg-black/60"
              />
              <View className="z-10 items-center" pointerEvents="box-none">
                {selectedItem ? (
                  <View
                    className="w-full max-w-md overflow-hidden rounded-2xl bg-[#FFFCF8]"
                    style={{ maxHeight: windowHeight * 0.92 }}
                  >
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingBottom: 16 }}
                    >
                      <View
                        className="relative w-full items-center bg-black"
                        style={{ height: viewerImageMaxH }}
                        collapsable={false}
                      >
                        <Image
                          source={selectedItem.source}
                          style={{ width: "100%", height: viewerImageMaxH }}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                          pointerEvents="none"
                        />
                        <Pressable
                          accessibilityLabel="Close"
                          disabled={isSavingCaption}
                          onPress={() => {
                            if (!isSavingCaption) setSelectedItem(null);
                          }}
                          hitSlop={12}
                          className="absolute left-2 top-2 z-20 h-10 w-10 items-center justify-center rounded-full bg-black/50 active:opacity-80"
                        >
                          <Text className="text-base font-bold leading-none text-white">×</Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Delete photo"
                          disabled={isDeleting || isSavingCaption}
                          hitSlop={12}
                          onPress={() => {
                            const itemIdToDelete = selectedItem.id;
                            Alert.alert(
                              "Delete photo",
                              "This will permanently delete this photo.",
                              [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Delete",
                                  style: "destructive",
                                  onPress: () => void handleDeletePhotoById(itemIdToDelete),
                                },
                              ]
                            );
                          }}
                          className="absolute right-2 top-2 z-20 h-10 w-10 items-center justify-center rounded-full bg-black/50 active:opacity-80 disabled:opacity-40"
                        >
                          <Ionicons name="trash-outline" size={18} color="#fff" />
                        </Pressable>
                      </View>
                      <View className="px-4 pt-4">
                        <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6B6B]">
                          Your comment
                        </Text>
                        <TextInput
                          value={viewerCaptionDraft}
                          onChangeText={setViewerCaptionDraft}
                          placeholder="Add a comment…"
                          placeholderTextColor="rgba(95,95,95,0.45)"
                          multiline
                          editable={!isSavingCaption}
                          className="min-h-[88px] rounded-xl border border-[#E6E1DA] bg-white px-3 py-3 text-base leading-6 text-[#0B0B0B]"
                          style={Platform.OS === "android" ? searchInputStyles.android : undefined}
                          textAlignVertical="top"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Save comment"
                          disabled={!viewerCaptionDirty || isSavingCaption}
                          onPress={() => void handleSaveViewerCaption()}
                          className="mt-3 self-end rounded-full bg-[#0B0B0B] px-5 py-2.5 active:opacity-80 disabled:opacity-40"
                        >
                          <Text className="text-sm font-semibold text-white">
                            {isSavingCaption ? "Saving…" : "Save"}
                          </Text>
                        </Pressable>
                      </View>
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </View>
          </KeyboardAvoidingView>
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
                  <View className="flex-row items-center justify-between border-b border-[#E6E1DA] px-3 py-2.5">
                    <Text className="shrink pr-3 text-sm font-medium text-[#0B0B0B]" numberOfLines={2}>
                      Weekly nudges
                    </Text>
                    <Switch
                      value={weeklyNudgeEnabled}
                      onValueChange={(v) => {
                        setWeeklyNudgeEnabledState(v);
                        void setWeeklyNudgeEnabled(v);
                      }}
                      trackColor={{ false: "#E6E1DA", true: "#0B7AEE" }}
                      thumbColor="#FFFFFF"
                      accessibilityLabel="Weekly nudges"
                    />
                  </View>
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
          onRequestClose={() => {
            setPendingAsset(null);
            setCaptionDraft("");
            setIntentDraft("");
          }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
            <Pressable
              className="flex-1"
              onPress={() => {
                setPendingAsset(null);
                setCaptionDraft("");
                setIntentDraft("");
              }}
            />
            <View className="rounded-t-3xl border-t border-gray-200 bg-white px-5 pb-10 pt-5">
              {pendingAsset ? (
                <Image
                  source={{ uri: pendingAsset.uri }}
                  style={{ width: "100%", height: 120, borderRadius: 12, marginBottom: 16 }}
                  contentFit="cover"
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
              <Text className="mb-2 text-base font-black text-black">I want to…</Text>
              <Text className="mb-2 text-xs leading-5 text-[#6B6B6B]">
                Optional — habits, trips, or tasks you asked Venn to remember for weekly recap.
              </Text>
              <View className="mb-4 rounded-2xl border border-gray-200 px-4 pb-3 pt-2">
                <TextInput
                  value={intentDraft}
                  onChangeText={setIntentDraft}
                  placeholder="e.g. Try that ramen spot on Saturday…"
                  placeholderTextColor="#9CA3AF"
                  className="text-base text-black"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  style={{
                    minHeight: 64,
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
                  onPress={() => {
                    setPendingAsset(null);
                    setCaptionDraft("");
                    setIntentDraft("");
                  }}
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
