-- Track where a memory came from when it was imported from an external post (e.g. Instagram share).
-- Nullable across the board so existing camera-roll uploads keep working without changes.

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_author text,
  ADD COLUMN IF NOT EXISTS source_platform text;

-- handy when we later want to list everything a user pulled in from a given platform
CREATE INDEX IF NOT EXISTS memories_source_platform_idx
  ON memories (user_id, source_platform)
  WHERE source_platform IS NOT NULL;
