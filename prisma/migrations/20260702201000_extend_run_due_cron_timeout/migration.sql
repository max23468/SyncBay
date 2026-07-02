-- Bound the Supabase Cron HTTP runner workload.
--
-- The runner can complete successfully after 30 seconds when it drains real
-- catalog jobs. Keep the automatic cron batch small and give pg_net enough time
-- to receive the response instead of recording a timeout.

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
      'https://syncbay.vercel.app/api/jobs/run-due?limit=2',
      'syncbay_run_due_url',
      'SyncBay run-due endpoint URL with cron batch limit 2'
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

  IF run_due_job_id IS NOT NULL AND run_due_command IS NOT NULL THEN
    PERFORM cron.alter_job(
      run_due_job_id,
      command := replace(
        replace(
          replace(
            run_due_command,
            'limit=5',
            'limit=2'
          ),
          'timeout_milliseconds := 30000',
          'timeout_milliseconds := 90000'
        ),
        'timeout_milliseconds := 60000',
        'timeout_milliseconds := 90000'
      )
    );
  END IF;
END
$$;
