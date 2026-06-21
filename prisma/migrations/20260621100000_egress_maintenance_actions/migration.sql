-- Reduce Supabase-internal bloat and make eBay account deletion dedupe cheap.

CREATE INDEX IF NOT EXISTS "EbayAccountDeletionRequest_hashedUserId_eventDate_status_idx"
  ON "EbayAccountDeletionRequest"("hashedUserId", "eventDate", "status");

CREATE INDEX IF NOT EXISTS "EbayAccountDeletionRequest_hashedUserId_publishDate_status_idx"
  ON "EbayAccountDeletionRequest"("hashedUserId", "publishDate", "status");

DO $migration$
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    DELETE FROM cron.job_run_details
    WHERE end_time < now() - interval '7 days';
  END IF;

  IF to_regclass('net._http_response') IS NOT NULL THEN
    DELETE FROM net._http_response
    WHERE created < now() - interval '1 day';
  END IF;

  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'syncbay-maintain-supabase-internal-tables'
    ) THEN
      PERFORM cron.unschedule('syncbay-maintain-supabase-internal-tables');
    END IF;

    PERFORM cron.schedule(
      'syncbay-maintain-supabase-internal-tables',
      '17 3 * * *',
      $command$
        DELETE FROM cron.job_run_details
        WHERE end_time < now() - interval '7 days';

        DELETE FROM net._http_response
        WHERE created < now() - interval '1 day';
      $command$
    );
  END IF;
END
$migration$;
