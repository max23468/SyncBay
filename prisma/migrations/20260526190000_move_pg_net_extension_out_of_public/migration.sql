-- Supabase linter segnala le estensioni installate nello schema public.
-- pg_net non supporta ALTER EXTENSION ... SET SCHEMA, quindi va ricreata.
-- Le funzioni runtime restano disponibili nello schema net.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_net'
      AND n.nspname = 'public'
  ) THEN
    DROP EXTENSION pg_net CASCADE;
    CREATE EXTENSION pg_net WITH SCHEMA extensions;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_net'
  ) THEN
    CREATE EXTENSION pg_net WITH SCHEMA extensions;
  END IF;
END $$;
