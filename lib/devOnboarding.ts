import { supabase } from "@/lib/supabase";
import { isMissingTableError } from "@/lib/supabaseSchema";

/** Dev-only: credentials for replaying the post-signup onboarding flow. */
export function getDevOnboardingCredentials(): { email: string; password: string } | null {
  if (!__DEV__) return null;
  const email = process.env.EXPO_PUBLIC_DEV_ONBOARDING_EMAIL?.trim();
  const password = process.env.EXPO_PUBLIC_DEV_ONBOARDING_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}

export function isDevOnboardingLoginEnabled(): boolean {
  return getDevOnboardingCredentials() !== null;
}

/** Wipe profile + interests so `isOnboardingComplete` is false. */
export async function resetOnboardingProfile(userId: string): Promise<void> {
  const { error: intErr } = await supabase
    .from("user_profile_interests")
    .delete()
    .eq("user_id", userId);
  if (intErr && !isMissingTableError(intErr, "user_profile_interests")) {
    throw intErr;
  }

  // Use upsert (not delete) — RLS allows update/insert but not delete on user_profiles.
  const { error: profErr } = await supabase.from("user_profiles").upsert(
    {
      user_id: userId,
      home_location: null,
      interests_freeform: null,
      onboarding_completed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (profErr && !isMissingTableError(profErr, "user_profiles")) {
    throw profErr;
  }
}

/** True when email matches the dev onboarding test account (case-insensitive). */
export function isDevOnboardingEmail(email: string): boolean {
  const creds = getDevOnboardingCredentials();
  if (!creds) return false;
  return email.trim().toLowerCase() === creds.email.toLowerCase();
}

/**
 * Sign in with the dev test account and clear onboarding state — same path as a brand-new user.
 * Create the account once in Supabase (or via Create Account), then set email/password in .env.
 */
export async function signInAsFreshOnboardingUser(): Promise<{ error?: string }> {
  const creds = getDevOnboardingCredentials();
  if (!creds) {
    return {
      error:
        "Add EXPO_PUBLIC_DEV_ONBOARDING_EMAIL and EXPO_PUBLIC_DEV_ONBOARDING_PASSWORD to .env (dev only).",
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });
  if (error) return { error: error.message };

  const userId = data.user?.id;
  if (!userId) return { error: "Signed in but no user id." };

  try {
    await resetOnboardingProfile(userId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reset onboarding profile." };
  }

  return {};
}
