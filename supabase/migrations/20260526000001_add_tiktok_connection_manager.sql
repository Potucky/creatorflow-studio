-- Add account manager columns to creatorflow_tiktok_connections
-- Safe to run multiple times; each statement is idempotent.

-- UUID identifier so frontend can reference connections without exposing open_id as PK
ALTER TABLE public.creatorflow_tiktok_connections
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

-- Display fields fetched from TikTok creator info at token exchange time
ALTER TABLE public.creatorflow_tiktok_connections
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- Lifecycle tracking columns
ALTER TABLE public.creatorflow_tiktok_connections
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill id for any rows that pre-date this migration
UPDATE public.creatorflow_tiktok_connections
  SET id = gen_random_uuid()
  WHERE id IS NULL;

-- Enforce NOT NULL now that all rows have a value
ALTER TABLE public.creatorflow_tiktok_connections
  ALTER COLUMN id SET NOT NULL;

-- Add unique constraint on id so the frontend can use it as a stable reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creatorflow_tiktok_connections_id_key'
    AND conrelid = 'public.creatorflow_tiktok_connections'::regclass
  ) THEN
    ALTER TABLE public.creatorflow_tiktok_connections
      ADD CONSTRAINT creatorflow_tiktok_connections_id_key UNIQUE (id);
  END IF;
END $$;
