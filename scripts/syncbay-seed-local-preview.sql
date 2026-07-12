-- Seed locale per la preview UI con stato "collegato", riproducendo i conteggi
-- reali di produzione (992 prodotti, 115 conflitti aperti, eBay CONNECTED,
-- catalogo aggiornato) SENZA dati personali del negoziante: niente token reali,
-- niente ebayUserId reale, location e gid sintetici. Solo i numeri aggregati e
-- lo stato derivano dalla produzione.
--
-- Idempotente: rimuove le righe `seed-%` e ricrea. Usa lo shop locale per
-- dominio, così funziona con qualunque id locale.
--
-- Uso:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f scripts/syncbay-seed-local-preview.sql

\set ON_ERROR_STOP on

DO $$
DECLARE
  sid text;
  mkt text := 'EBAY_IT';
BEGIN
  SELECT id INTO sid FROM "Shop"
   WHERE "shopDomain" = 'fixture-shop.myshopify.com'
   ORDER BY "createdAt" DESC LIMIT 1;
  IF sid IS NULL THEN
    RAISE EXCEPTION 'Nessuno Shop locale sintetico per fixture-shop.myshopify.com';
  END IF;

  UPDATE "Shop" SET
    "syncEnabled" = true,
    "syncTargetSeconds" = 300,
    "defaultProductStatus" = 'ACTIVE',
    "productPublicationMode" = 'ALL',
    "defaultLocationGid" = 'gid://shopify/Location/0',
    "installationStatus" = 'INSTALLED',
    "updatedAt" = now()
  WHERE id = sid;

  -- eBay collegato (stato reale; nessun token reale)
  INSERT INTO "EbayConnection"
    (id, "shopId", "marketplaceId", environment, status, "ebayUserId",
     "encryptedAccessToken", "encryptedRefreshToken",
     "tokenExpiresAt", "refreshTokenExpiresAt", scopes,
     "connectedAt", "lastRefreshAt", "createdAt", "updatedAt")
  VALUES
    ('seed-ebay-' || sid, sid, mkt, 'production', 'CONNECTED', 'local-preview',
     'seed-placeholder', 'seed-placeholder',
     now() + interval '1 hour', now() + interval '500 days', 'sell.inventory',
     timestamp '2026-05-25 19:18:18', now() - interval '1 hour', now(), now())
  ON CONFLICT ("shopId", "marketplaceId") DO UPDATE SET
    status = 'CONNECTED',
    "connectedAt" = excluded."connectedAt",
    "updatedAt" = now();

  -- pulizia seed precedente
  DELETE FROM "AuditLog" WHERE id LIKE 'seed-%';
  DELETE FROM "SyncConflict" WHERE id LIKE 'seed-%';
  DELETE FROM "SyncJob" WHERE id LIKE 'seed-%';
  DELETE FROM "ProductMapping" WHERE id LIKE 'seed-%';

  -- 992 prodotti collegati (conteggio reale di produzione)
  INSERT INTO "ProductMapping"
    (id, "shopId", "marketplaceId", "ebayItemId", sku,
     "shopifyProductGid", status, "lastSyncedAt", "createdAt", "updatedAt")
  SELECT
    'seed-map-' || g, sid, mkt,
    '1' || lpad(g::text, 11, '0'), 'SKU-' || g,
    'gid://shopify/Product/' || (1000000 + g), 'ACTIVE',
    now() - interval '2 hours', now(), now()
  FROM generate_series(1, 992) g;

  -- attività recente + salute catalogo "aggiornato"
  INSERT INTO "SyncJob"
    (id, "shopId", type, status, attempts, "maxAttempts",
     "startedAt", "finishedAt", "createdAt", "updatedAt")
  VALUES
    ('seed-job-imp', sid, 'IMPORT_CATALOG', 'SUCCEEDED', 1, 3,
     now() - interval '3 hours', now() - interval '170 minutes',
     now() - interval '3 hours', now()),
    ('seed-job-inc', sid, 'SYNC_INCREMENTAL', 'SUCCEEDED', 1, 3,
     now() - interval '3 minutes', now() - interval '2 minutes',
     now() - interval '3 minutes', now()),
    ('seed-job-stk', sid, 'UPDATE_EBAY_STOCK', 'SUCCEEDED', 1, 3,
     now() - interval '20 minutes', now() - interval '19 minutes',
     now() - interval '20 minutes', now());

  -- 115 conflitti aperti (conteggio reale di produzione)
  INSERT INTO "SyncConflict"
    (id, "shopId", "mappingId", field, status,
     "ebayValue", "shopifyValue", "detectedAt", "createdAt", "updatedAt")
  SELECT
    'seed-conf-' || g, sid, 'seed-map-' || g,
    (array['description', 'images', 'quantity', 'status'])[1 + (g % 4)],
    'OPEN',
    to_jsonb((10 + g)::text), to_jsonb((9 + g)::text),
    now() - interval '1 hour', now(), now()
  FROM generate_series(1, 115) g;

  -- audit recente
  INSERT INTO "AuditLog" (id, "shopId", type, message, "createdAt")
  VALUES
    ('seed-aud-inc', sid, 'SYNC_JOB_SUCCEEDED',
     'Aggiornamento catalogo completato.', now() - interval '6 minutes'),
    ('seed-aud-ebay', sid, 'EBAY_CONNECTED',
     'Account eBay collegato.', timestamp '2026-05-25 19:18:18');
END $$;

select
  (select count(*) from "ProductMapping") as mappings,
  (select count(*) from "SyncConflict" where status = 'OPEN') as open_conflicts,
  (select status::text from "EbayConnection" limit 1) as ebay_status;
