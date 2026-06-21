-- Keep SyncBay's Prisma-owned tables private from Supabase client roles.
-- Runtime access uses server-side database credentials, not anon/authenticated Data API clients.

DO $$
DECLARE
  syncbay_table text;
  syncbay_tables text[] := ARRAY[
    'AuditLog',
    'DescriptionRule',
    'EbayAccountDeletionRequest',
    'EbayConnection',
    'EbayOAuthState',
    'PricingRule',
    'ProductMapping',
    'ProductSnapshot',
    'Session',
    'Shop',
    'SyncConflict',
    'SyncJob',
    '_prisma_migrations'
  ];
BEGIN
  FOREACH syncbay_table IN ARRAY syncbay_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', syncbay_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS "syncbay_deny_client_access" ON public.%I',
      syncbay_table
    );
    EXECUTE format(
      'CREATE POLICY "syncbay_deny_client_access" ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      syncbay_table
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated, service_role',
      syncbay_table
    );
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated, service_role, public;

DROP INDEX IF EXISTS "EbayAccountDeletionRequest_hashedUserId_eventDate_status_idx";
DROP INDEX IF EXISTS "EbayAccountDeletionRequest_hashedUserId_publishDate_status_idx";
DROP INDEX IF EXISTS "ProductMapping_sku_idx";
