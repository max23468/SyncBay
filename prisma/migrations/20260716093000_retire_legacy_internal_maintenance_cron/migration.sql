-- The application-level daily maintenance owns cron history retention now.
-- Retire the legacy pg_cron job: it kept only 7 days of cron history and
-- deleted pg_net responses independently from observed growth, both of which
-- conflict with the current retention policy.

DO $migration$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
    AND to_regprocedure('cron.unschedule(text)') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'syncbay-maintain-supabase-internal-tables'
    )
  THEN
    PERFORM cron.unschedule('syncbay-maintain-supabase-internal-tables');
  END IF;
END
$migration$;
