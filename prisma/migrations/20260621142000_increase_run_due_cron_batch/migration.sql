-- Increase the automatic runner drain batch while keeping the 2-minute cron cadence.

DO $$
DECLARE
  run_due_secret_id uuid;
BEGIN
  IF to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') IS NULL THEN
    RETURN;
  END IF;

  SELECT id
  INTO run_due_secret_id
  FROM vault.decrypted_secrets
  WHERE name = 'syncbay_run_due_url'
  LIMIT 1;

  IF run_due_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(
      run_due_secret_id,
      'https://syncbay.vercel.app/api/jobs/run-due?limit=10',
      'syncbay_run_due_url',
      'SyncBay run-due endpoint URL with cron batch limit 10'
    );
  END IF;
END
$$;

DO $$
DECLARE
  run_due_job_id bigint;
  run_due_command text;
BEGIN
  IF to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') IS NULL THEN
    RETURN;
  END IF;

  SELECT jobid, command
  INTO run_due_job_id, run_due_command
  FROM cron.job
  WHERE jobname = 'syncbay-run-due-jobs'
  LIMIT 1;

  IF run_due_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      run_due_job_id,
      command := replace(
        run_due_command,
        'timeout_milliseconds := 10000',
        'timeout_milliseconds := 30000'
      )
    );
  END IF;
END
$$;
