# Provisioning runtime

Questa guida traccia il provisioning minimo Vercel + Supabase e gli aggiornamenti post-scaffold.

Non contiene segreti reali. Password, token e connection string complete devono restare nei provider runtime o nel Keychain locale.

## Stato

Provisioning minimo completato il 2026-05-09.

Lo scaffold Shopify CLI React Router esiste. Esiste un primo deployment Vercel
production pronto. Il batch draft pilota è stato verificato sul dev store; non
esistono ancora import completo fino a 2.000 prodotti o sync catalogo.

Lo schema Prisma iniziale include sessioni Shopify, shop installati, connessione eBay, state OAuth eBay, job applicativi, audit log, mapping prodotto, snapshot prodotto e conflitti Shopify. Le migration sono tracciate in `prisma/migrations/`.

## Vercel

| Campo | Valore |
| --- | --- |
| Scope | `matteos-projects-9226d217` |
| Project name | `syncbay` |
| Project ID | `prj_X9vkqDlE5t4QDUhOxE6m2aMFosiz` |
| Root directory | `.` |
| Node.js | `24.x` |
| Framework | `react-router` |
| Production domain | `https://syncbay.vercel.app` |
| Ultimo deployment | `READY` |
| Link locale | Creato in `.vercel/`, ignorato da Git |

Note:

- Il framework preset Vercel è `react-router`.
- Esiste un deployment production Vercel, ma non è ancora una release pubblica Shopify App Store.
- Gli env Vercel production e development sono stati impostati per Shopify, database, job, sicurezza e storage. Gli env preview restano da completare: la CLI Vercel ha richiesto uno scope di branch per il contesto Preview.
- Gli env eBay devono usare il keyset dedicato SyncBay, non keyset di altri progetti.
- Gli env eBay account deletion sono predisposti in Development e Production; `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED` resta controllato da flag e va abilitato solo dopo deploy/migration e test notification riuscita.
- `SYNCBAY_DRAFT_IMPORT_ENABLED=false` resta il default di sicurezza nel codice. Sul runtime pilota può essere riattivato dopo il deploy della versione che registra mapping, snapshot, job e audit.
- `SYNCBAY_DRAFT_IMPORT_LIMIT=3` limita il batch pilota di bozze Shopify; aumentarlo solo in modo graduale dopo verifica manuale di mapping, snapshot e audit.
- Vercel Web Analytics e Speed Insights sono integrati nel root React; i dati vanno abilitati/letti dal dashboard Vercel dopo visite reali.
- Vercel Cron non è il meccanismo primario SyncBay: polling, queue drain e retry restano su Supabase Cron/Queues come da ADR 0005.

## Supabase

| Campo | Valore |
| --- | --- |
| Organization ID | `dvparweojjzveymxscdy` |
| Project name | `SyncBay` |
| Project ref | `mgjcbuokppfnglsftsmi` |
| Region | `eu-west-1` |
| Postgres | `17.6` |
| Link locale | `supabase/config.toml` |

La password database generata durante il provisioning è stata salvata nel Keychain macOS:

```text
service: syncbay-supabase-db-password
account: SyncBay
```

Non salvarla in Git e non stamparla nei log.

## Verifiche eseguite

- `vercel whoami`
- `vercel project inspect syncbay`
- `supabase projects list`
- `supabase link --project-ref mgjcbuokppfnglsftsmi`
- query remota Supabase: database `postgres`, versione `17.6`
- `npx prisma migrate deploy` iniziale su Supabase tramite pooler
- migration OAuth eBay applicata su Supabase con `supabase db query --linked` e registrazione in `_prisma_migrations`
- primitive Supabase runtime applicate con `supabase db query --linked`: `pgmq`, `pg_cron`, coda `syncbay_jobs`, bucket privato `syncbay-import-staging`
- advisor Supabase security/performance senza issue dopo abilitazione RLS su `_prisma_migrations`
- migration runtime primitives e mapping/snapshot/conflitti applicate su Supabase con `supabase db query --linked` e registrate in `_prisma_migrations`, perché `npx prisma migrate deploy` si fermava sul pooler con errore opaco dello schema engine
- verifica SQL remota: tabelle `ProductMapping`, `ProductSnapshot` e `SyncConflict` presenti con RLS attivo
- `shopify app dev --store syncbay-dev.myshopify.com` con preview Admin caricata e sessione installazione registrata

Estensioni Supabase verificate:

| Estensione | Stato |
| --- | --- |
| `pgcrypto` | Installata |
| `uuid-ossp` | Installata |
| `pgmq` | Abilitata via migration Prisma |
| `pg_cron` | Abilitata via migration Prisma |

Primitive Supabase tracciate:

- estensione `pgmq`;
- coda `syncbay_jobs`;
- estensione `pg_cron`;
- bucket privato `syncbay-import-staging` per staging temporaneo immagini.

Non ci sono ancora schedule cron o consumer queue attivi: il runtime import
draft registra `SyncJob` idempotenti con tentativi e risultato, mentre retry
automatici e drenaggio queue verranno aggiunti quando l'import controllato
verrà esteso oltre il batch pilota.

## Cosa resta da fare

Durante o subito dopo lo scaffold:

- mantenere allineate le migration Prisma su Supabase Postgres;
- definire `DATABASE_URL` e `DATABASE_DIRECT_URL` nei provider, non nel repo;
- completare gli env Vercel preview quando viene scelto il branch target o via dashboard;
- verificare gli advisor Supabase con `npm run db:verify` quando le credenziali linked sono disponibili;
- aggiornare URL Shopify/eBay con il primo URL Vercel utilizzabile.
