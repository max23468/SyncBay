# Provisioning runtime

Questa guida traccia il provisioning minimo Vercel + Supabase prima dello scaffold applicativo.

Non contiene segreti reali. Password, token e connection string complete devono restare nei provider runtime o nel Keychain locale.

## Stato

Provisioning minimo completato il 2026-05-09.

Lo scaffold Shopify CLI React Router esiste. Non esistono ancora deploy runtime, schema database SyncBay oltre alla tabella sessioni prevista da Prisma, import catalogo o sync.

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

- Il framework preset e `Other` finche non esiste lo scaffold Shopify React Router.
- Nessun deploy production e stato creato.
- Gli env Vercel verranno impostati dopo lo scaffold, quando saranno chiari nomi, callback e secret reali.

## Supabase

| Campo | Valore |
| --- | --- |
| Organization ID | `dvparweojjzveymxscdy` |
| Project name | `SyncBay` |
| Project ref | `mgjcbuokppfnglsftsmi` |
| Region | `eu-west-1` |
| Postgres | `17.6` |
| Link locale | `supabase/config.toml` |

La password database generata durante il provisioning e stata salvata nel Keychain macOS:

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

Estensioni Supabase verificate:

| Estensione | Stato |
| --- | --- |
| `pgcrypto` | Installata |
| `uuid-ossp` | Installata |
| `pgmq` | Disponibile, non installata |
| `pg_cron` | Disponibile, non installata |

`pgmq` e `pg_cron` vanno abilitate tramite migration quando verra creato lo schema runtime, cosi restano tracciate in Git.

## Cosa resta da fare

Durante o subito dopo lo scaffold:

- configurare Prisma su Supabase Postgres;
- definire `DATABASE_URL` e `DATABASE_DIRECT_URL` nei provider, non nel repo;
- impostare gli env Vercel reali;
- creare bucket Supabase Storage `syncbay-import-staging` via migration o script tracciato;
- abilitare Supabase Queues/Cron via migration;
- aggiornare URL Shopify/eBay con il primo URL Vercel utilizzabile.
