-- Structured time signals from user caption + want_to_do (phase 1).
-- JSON shape: see lib/extractTemporalFromUserText.ts (TextTemporalPayload).

ALTER TABLE memories ADD COLUMN IF NOT EXISTS text_temporal jsonb;

COMMENT ON COLUMN memories.text_temporal IS 'Heuristic time extraction from user_caption + want_to_do at upload (client).';
