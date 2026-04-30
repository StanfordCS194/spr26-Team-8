-- Weekly nudges: upload intents, chat transcript, condensed recap rows.
-- Apply in Supabase SQL editor or `supabase db push` after linking the project.

-- Optional line at Library upload (“I want to…”)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS want_to_do text;

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_user_created_desc
  ON chat_messages (user_id, created_at DESC);

-- One recap per user per UTC-week anchor (Monday date YYYY-MM-DD)
CREATE TABLE IF NOT EXISTS weekly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  week_anchor text NOT NULL,
  bullets text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_anchor)
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_recaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_insert_own"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_messages_select_own"
  ON chat_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "weekly_recaps_select_own"
  ON weekly_recaps FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "weekly_recaps_insert_own"
  ON weekly_recaps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "weekly_recaps_update_own"
  ON weekly_recaps FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
