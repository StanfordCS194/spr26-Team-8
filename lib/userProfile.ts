import { getOnboardingStockImage } from "@/lib/onboardingStockImages";
import { supabase } from "@/lib/supabase";
import { isMissingTableError } from "@/lib/supabaseSchema";

export type UserProfileRow = {
  user_id: string;
  home_location: string | null;
  interests_freeform: string | null;
  onboarding_completed_at: string | null;
};

export type SaveOnboardingInput = {
  homeLocation: string;
  selectedStockImageIds: string[];
  interestsFreeform?: string;
};

/** True when onboarding_completed_at is set (missing table → treat as complete to avoid blocking). */
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error, "user_profiles")) return true;
    if (__DEV__) console.warn("[userProfile] isOnboardingComplete:", error.message);
    return true;
  }

  const at = (data as { onboarding_completed_at?: string | null } | null)?.onboarding_completed_at;
  return Boolean(at);
}

/** Text block for chat + weekly nudges (location, stock picks, optional freeform). */
export async function fetchUserProfileContext(userId: string): Promise<string> {
  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("home_location, interests_freeform")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr && !isMissingTableError(profileErr, "user_profiles")) {
    if (__DEV__) console.warn("[userProfile] profile fetch:", profileErr.message);
    return "";
  }

  const { data: interests, error: intErr } = await supabase
    .from("user_profile_interests")
    .select("search_text, stock_image_id")
    .eq("user_id", userId);

  if (intErr && !isMissingTableError(intErr, "user_profile_interests")) {
    if (__DEV__) console.warn("[userProfile] interests fetch:", intErr.message);
  }

  const lines: string[] = [];
  const loc = (profile as UserProfileRow | null)?.home_location?.trim();
  if (loc) lines.push(`Based in: ${loc}`);

  const interestRows =
    (interests as { search_text: string; stock_image_id: string }[] | null) ?? [];
  if (interestRows.length > 0) {
    lines.push("Interests they chose at signup (from images):");
    interestRows.forEach((row, i) => {
      lines.push(`${i + 1}. ${row.search_text.trim()}`);
    });
  }

  const free = (profile as UserProfileRow | null)?.interests_freeform?.trim();
  if (free) lines.push(`They also said: ${free}`);

  return lines.join("\n");
}

export async function saveOnboardingProfile(
  userId: string,
  input: SaveOnboardingInput
): Promise<void> {
  const home = input.homeLocation.trim();
  if (!home) throw new Error("Add where you are based.");

  const freeform = input.interestsFreeform?.trim() || null;
  const now = new Date().toISOString();

  const { error: profileError } = await supabase.from("user_profiles").upsert(
    {
      user_id: userId,
      home_location: home,
      interests_freeform: freeform,
      onboarding_completed_at: now,
      updated_at: now,
    },
    { onConflict: "user_id" }
  );

  if (profileError) {
    if (isMissingTableError(profileError, "user_profiles")) {
      throw new Error(
        "Profile tables are missing. Run supabase/migrations/20260518100000_user_onboarding_profile.sql in Supabase."
      );
    }
    throw profileError;
  }

  const { error: deleteError } = await supabase
    .from("user_profile_interests")
    .delete()
    .eq("user_id", userId);

  if (deleteError && !isMissingTableError(deleteError, "user_profile_interests")) {
    throw deleteError;
  }

  const rows = input.selectedStockImageIds
    .map((id) => {
      const stock = getOnboardingStockImage(id);
      if (!stock) return null;
      return {
        user_id: userId,
        stock_image_id: id,
        search_text: stock.searchText,
      };
    })
    .filter(Boolean) as {
    user_id: string;
    stock_image_id: string;
    search_text: string;
  }[];

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("user_profile_interests").insert(rows);
    if (insertError) {
      if (isMissingTableError(insertError, "user_profile_interests")) {
        throw new Error(
          "Profile tables are missing. Run supabase/migrations/20260518100000_user_onboarding_profile.sql in Supabase."
        );
      }
      throw insertError;
    }
  }
}
