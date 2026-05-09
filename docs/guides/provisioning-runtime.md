# Provisioning runtime

Questa guida traccia il provisioning minimo Vercel + Supabase e gli aggiornamenti post-scaffold.

Non contiene segreti reali. Password, token e connection string complete devono restare nei provider runtime o nel Keychain locale.

## Stato

Provisioning minimo completato il 2026-05-09.

Lo scaffold Shopify CLI React Router esiste. Non esistono ancora deploy runtime, import catalogo o sync.

Lo schema Prisma iniziale include sessioni Shopify, shop installati, connessione eBay, state OAuth eBay, job applicativi e audit log. Le migration sono tracciate in `prisma/migrations/`.

## Vercel

| Campo | Valore |
| --- | --- |
| Scope | `matteos-projects-9226d217` |
| Project name | `syncbay` |
| Project ID | `prj_X9vkqDlE5t4QDUhOxE6m2aMFosiz` |
| Root directory | `.` |
| Node.js | `24.x` |
| Link locale | Creato in `.vercel/`, ignorato da Git |

Note:

- Il framework preset e `Other` finché il deploy React Router non viene verificato su Vercel.
- Nessun deploy production è stato creato.
- Gli env Vercel production e development sono stati impostati per Shopify, database, job, sicurezza e storage. Gli env preview restano da completare: la CLI Vercel ha richiesto uno scope di branch per il contesto Preview.

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
- `shopify app dev --store syncbay-dev.myshopify.com` con preview Admin caricata e sessione installazione registrata

Estensioni Supabase verificate:

| Estensione | Stato |
| --- | --- |
| `pgcrypto` | Installata |
| `uuid-ossp` | Installata |
| `pgmq` | Disponibile, non installata |
| `pg_cron` | Disponibile, non installata |

`pgmq` e `pg_cron` vanno abilitate tramite migration quando verrà creato lo schema runtime, così restano tracciate in Git.

## Cosa resta da fare

Durante o subito dopo lo scaffold:

- mantenere allineate le migration Prisma su Supabase Postgres;
- definire `DATABASE_URL` e `DATABASE_DIRECT_URL` nei provider, non nel repo;
- completare gli env Vercel preview quando viene scelto il branch target o via dashboard;
- creare bucket Supabase Storage `syncbay-import-staging` via migration o script tracciato;
- abilitare Supabase Queues/Cron via migration;
- aggiornare URL Shopify/eBay con il primo URL Vercel utilizzabile.
