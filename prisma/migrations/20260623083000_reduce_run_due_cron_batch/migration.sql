-- Reduce the automatic runner batch to lower Supabase pooler egress during the pilot.

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
      'https://syncbay.vercel.app/api/jobs/run-due?limit=5',
      'syncbay_run_due_url',
      'SyncBay run-due endpoint URL with cron batch limit 5'
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
        replace(run_due_command, 'limit=10', 'limit=5'),
        'limit=20',
        'limit=5'
      )
    );
  END IF;
END
$$;
