-- Move the pilot runner to a 5-minute cadence and align saved sync targets.

UPDATE "Shop"
SET "syncTargetSeconds" = 300
WHERE "syncTargetSeconds" < 300;

UPDATE "Shop"
SET "syncTargetSeconds" = 1800
WHERE "syncTargetSeconds" > 1800;

DO $$
DECLARE
  run_due_job_id bigint;
BEGIN
  IF to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL THEN
    RETURN;
  END IF;

  SELECT jobid
  INTO run_due_job_id
  FROM cron.job
  WHERE jobname = 'syncbay-run-due-jobs'
  LIMIT 1;

  IF run_due_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      run_due_job_id,
      schedule := '*/5 * * * *'
    );
  END IF;
END
$$;
