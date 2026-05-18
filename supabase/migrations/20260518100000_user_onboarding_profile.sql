-- Profile + onboarding interests (stock-image selections with search text for chat/nudges).

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  home_location text,
  interests_freeform text,
  onboarding_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profile_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stock_image_id text NOT NULL,
  search_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, stock_image_id)
);

CREATE INDEX IF NOT EXISTS user_profile_interests_user_id_idx
  ON user_profile_interests (user_id);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles_select_own"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_profiles_insert_own"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profiles_update_own"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_interests_select_own"
  ON user_profile_interests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_profile_interests_insert_own"
  ON user_profile_interests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_interests_delete_own"
  ON user_profile_interests FOR DELETE
  USING (auth.uid() = user_id);

-- Optional: mark existing users complete so they are not forced through onboarding on deploy.
-- INSERT INTO user_profiles (user_id, onboarding_completed_at)
-- SELECT id, now() FROM auth.users
-- ON CONFLICT (user_id) DO NOTHING;
