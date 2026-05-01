import { supabase } from "@/lib/supabase";
import { isMissingTableError } from "@/lib/supabaseSchema";

const SIDECAR_URL = process.env.EXPO_PUBLIC_EMBED_SIDECAR_URL ?? "";
const MODEL_NAME = "MobileCLIP-S0";
const TABLE = "image_embeddings";

type EmbedResponse = {
  model_name: string;
  dimension: number;
  embedding: number[];
};

async function getAuthHeader(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

function devWarn(label: string, err: unknown) {
  if (__DEV__) console.warn(`[embeddings] ${label}:`, err);
}

export async function embedAndStoreImage(args: {
  memoryId: string;
  userId: string;
  bytes: ArrayBuffer;
}): Promise<void> {
  if (!SIDECAR_URL) {
    devWarn("skip image embed", "EXPO_PUBLIC_EMBED_SIDECAR_URL not set");
    return;
  }
  const auth = await getAuthHeader();
  if (!auth) {
    devWarn("skip image embed", "no Supabase session");
    return;
  }
  let embedding: number[];
  try {
    const res = await fetch(`${SIDECAR_URL}/embed/image`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/octet-stream" },
      body: args.bytes,
    });
    if (!res.ok) {
      devWarn("image embed http", `${res.status} ${await res.text()}`);
      return;
    }
    const json = (await res.json()) as EmbedResponse;
    embedding = json.embedding;
  } catch (err) {
    devWarn("image embed fetch", err);
    return;
  }

  const { error } = await supabase.from(TABLE).insert({
    memory_id: args.memoryId,
    user_id: args.userId,
    model_name: MODEL_NAME,
    embedding,
  });
  if (error && !isMissingTableError(error, TABLE)) {
    devWarn("image embed insert", error.message);
  } else if (error) {
    devWarn("image embed insert", "image_embeddings table missing — apply migration");
  }
}

export async function searchByEmbedding(
  text: string,
  opts: { signal?: AbortSignal; matchCount?: number } = {}
): Promise<string[] | null> {
  if (!SIDECAR_URL) return null;
  const auth = await getAuthHeader();
  if (!auth) return null;

  let embedding: number[];
  try {
    const res = await fetch(`${SIDECAR_URL}/embed/text`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: opts.signal,
    });
    if (!res.ok) {
      devWarn("text embed http", `${res.status} ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as EmbedResponse;
    embedding = json.embedding;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return null;
    devWarn("text embed fetch", err);
    return null;
  }

  const { data, error } = await supabase.rpc("search_memories_by_embedding", {
    query_embedding: embedding,
    match_count: opts.matchCount ?? 30,
    model_name_filter: MODEL_NAME,
  });
  if (error) {
    if (!isMissingTableError(error, TABLE)) devWarn("rpc", error.message);
    return null;
  }
  const rows = (data ?? []) as { memory_id: string }[];
  return rows.map((r) => r.memory_id);
}
