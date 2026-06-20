-- Reduce idle Supabase Cron traffic and align the configurable sync target floor.

UPDATE "Shop"
SET "syncTargetSeconds" = 120
WHERE "syncTargetSeconds" < 120;

DO $$
DECLARE
  run_due_job_id bigint;
BEGIN
  SELECT jobid
  INTO run_due_job_id
  FROM cron.job
  WHERE jobname = 'syncbay-run-due-jobs'
  LIMIT 1;

  IF run_due_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      run_due_job_id,
      schedule := '*/2 * * * *'
    );
  END IF;
END
$$;
