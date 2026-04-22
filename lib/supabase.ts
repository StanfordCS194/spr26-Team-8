import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
  );
}

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const isServer = typeof window === "undefined";

const memoryStorage = new Map<string, string>();

const storage: StorageAdapter = isServer
  ? {
      getItem: async (key) => memoryStorage.get(key) ?? null,
      setItem: async (key, value) => {
        memoryStorage.set(key, value);
      },
      removeItem: async (key) => {
        memoryStorage.delete(key);
      },
    }
  : ((AsyncStorage as unknown as StorageAdapter) ?? {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    });

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
