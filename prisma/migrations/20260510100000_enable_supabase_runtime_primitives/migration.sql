-- Enable the Supabase runtime primitives already selected for SyncBay.
-- Queue consumption and cron schedules are intentionally added later, when
-- the import/sync worker logic exists.

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pgmq.list_queues()
    WHERE queue_name = 'syncbay_jobs'
  ) THEN
    PERFORM pgmq.create('syncbay_jobs');
  END IF;
END
$$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'syncbay-import-staging',
  'syncbay-import-staging',
  false,
  52428800,
  ARRAY[
    'image/avif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = NOW();
