# Toolchain - SyncBay

Questo documento dichiara runtime, package manager, lockfile, tool e verifiche applicabili a SyncBay.

## Runtime locale

| Area                      | Valore                                        |
| ------------------------- | --------------------------------------------- |
| Runtime principale        | Node.js                                       |
| Versione locale preferita | `.node-version` = `24.16.0`                   |
| Range supportato          | `package.json` `engines.node` = `>=24.15 <25` |
| Enforcement engine        | `.npmrc` con `engine-strict=true`             |
| Package manager           | `npm@11.14.1`                                 |
| Lockfile                  | `package-lock.json`                           |
| Immagine Docker base      | `node:24.16.0-alpine`                         |

Il floor Node `>=24.15` è richiesto dalla catena `react-doctor@latest` tramite `ini@7`; non abbassarlo senza cambiare strategia sul quality gate. La base Docker è pinnata a Node 24.16.0 per evitare drift sotto il floor richiesto da `.npmrc` con `engine-strict=true`. Il package manager canonico è dichiarato in `package.json` come `npm@11.14.1`.

## Stack applicativo

| Area                        | Tool                                  |
| --------------------------- | ------------------------------------- |
| Shopify app                 | Shopify CLI `4.1.0`                   |
| Frontend/backend app        | React Router, React, TypeScript, Vite |
| Hosting previsto            | Vercel                                |
| Database                    | Supabase Postgres                     |
| ORM                         | Prisma                                |
| Queue e scheduler previsti  | Supabase Queues e Supabase Cron       |
| Storage immagini temporaneo | Supabase Storage privato              |
| Osservabilità baseline      | Vercel Web Analytics e Speed Insights |
| Quality React               | React Doctor                          |

## Tool agenti Shopify

Per sviluppo assistito su superfici Shopify, la postazione locale può usare
Shopify AI Toolkit installato come skill globali dell'agente:

- installazione: `npx skills add Shopify/shopify-ai-toolkit`;
- skill attese: `shopify-admin`, `shopify-use-shopify-cli`,
  `shopify-polaris-app-home`, `shopify-app-store-review`, `shopify-dev` e le
  altre skill Shopify installate dal toolkit;
- Dev MCP Shopify opzionale: `shopify-dev-mcp` via `npx -y @shopify/dev-mcp@latest`
  nella configurazione locale Codex.

Questi tool non sono dipendenze runtime di SyncBay e non sostituiscono ADR,
documentazione del progetto o verifiche locali. Le skill installate manualmente
non si aggiornano da sole: prima di usarle per decisioni sensibili su API,
App Store, compliance o CLI, verifica la documentazione Shopify corrente.

## Comandi locali

| Scopo                    | Comando                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Installazione            | `npm install`                                                                           |
| Sviluppo Shopify         | `npm run dev`                                                                           |
| Typecheck                | `npm run typecheck`                                                                     |
| Lint                     | `npm run lint`                                                                          |
| Build                    | `npm run build`                                                                         |
| Smoke UI                 | `npm run smoke:ui`                                                                      |
| Test librerie pure       | `npm run test:lib`                                                                      |
| Coverage moduli puri     | `npm run coverage:lib`                                                                  |
| Validazione Prisma       | `npm run prisma:validate`                                                               |
| Advisor Supabase         | `npm run db:verify`                                                                     |
| Diagnostica job import   | `npm run jobs:status -- --shop syncbay-dev.myshopify.com`                               |
| Readiness ordini pagati  | `npm run orders:paid-readiness -- --shop syncbay-dev.myshopify.com`                     |
| Verifica campione import | `npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 10`                 |
| Riparazione prezzo/SKU   | `npm run import:repair-commercial-fields -- --shop syncbay-dev.myshopify.com --dry-run` |
| Ripristino stock eBay    | `npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write` |
| Test guardia stock eBay  | `npm run test:stock-guard`                                                             |
| React Doctor             | `npm run quality:react-doctor`                                                          |
| Release dry-run          | `npm run release:dry-run`                                                               |
| Release locale           | `npm run release`                                                                       |

`npm run db:verify` richiede progetto Supabase linked e credenziali disponibili. Le migration remote vanno applicate esplicitamente con `npx prisma migrate deploy` o, se il pooler blocca Prisma, con la procedura documentata in `docs/guides/provisioning-runtime.md`.
`npm run jobs:status` usa `supabase db query --linked` e non richiede `DATABASE_URL` locale; usa `SUPABASE_DB_PASSWORD` o il Portachiavi macOS `syncbay-supabase-db-password` quando disponibile. Evita query concorrenti ripetute perché Supabase può bloccare temporaneamente nuove connessioni dopo troppi tentativi di autenticazione.
`npm run orders:paid-readiness` usa lo stesso accesso Supabase in sola lettura
per verificare sessione offline Shopify, scope `read_orders`/`write_orders`,
coda stock/sync e mapping candidati con snapshot `EUR` prima di una prova reale
`orders/paid`; non stampa token, segreti o dati cliente.
`npm run import:verify` usa Supabase CLI linked più Shopify CLI store execute in sola lettura per confrontare un campione dell'ultima run import tra snapshot eBay/SyncBay, mapping e prodotto Shopify live.
`npm run import:repair-commercial-fields` usa gli stessi snapshot per riallineare prezzo e SKU variante Shopify quando serve riparare prodotti creati prima del fix dedicato; usa sempre `--dry-run` prima della mutation reale.
`npm run stock:restore-ebay` è una scrittura reale su eBay: richiede `--confirm-real-ebay-write`, blocca l'esecuzione se ci sono job stock/sync attivi, verifica con Trading API `GetItem` e registra uno snapshot `SYNCBAY` di ripristino.
`npm run coverage:lib` usa solo il test runner nativo di Node e limita la coverage ai moduli puri `app/lib` già isolabili dal runtime live; la soglia Atlas corrente è `>=75%` linee e `>=65%` branch su quel perimetro.
`npm run build` esegue sempre `prisma generate` tramite `prebuild`, per mantenere il Prisma Client allineato allo schema anche nei deploy Vercel con cache installazione.

## Verifiche per tipo di modifica

| Tipo modifica                                                       | Verifiche proporzionate                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Docs-only                                                           | Review contenuto e `git diff --check`                                           |
| Runtime TypeScript/UI                                               | `npm run typecheck`, `npm run lint`, `npm run build`                            |
| Moduli puri `app/lib` o audit coverage Atlas                        | `npm run test:lib`, `npm run coverage:lib`, poi `npm run typecheck`, `npm run lint` quando pertinenti |
| Qualità React dopo release major/minor o cambi UI/React trasversali | `npm run quality:react-doctor` con `npx --yes react-doctor@latest`              |
| Flussi UI principali                                                | `npm run smoke:ui` quando il dev server o lo script sono applicabili            |
| Prisma/database                                                     | `npm run prisma:validate`; `npm run db:verify` se Supabase linked è disponibile |
| Guardia stock eBay, valuta o dry-run                                | `npm run test:stock-guard`; poi `npm run typecheck`, `npm run lint`, `npm run build` |
| Versioning/changelog runtime                                        | `npm run release:dry-run`                                                       |

## Deploy e release

SyncBay ha versioning locale, un deployment pilota Vercel production e una
policy tag/GitHub Release per release prodotto reali. Non ha ancora una policy
di release pubblica Shopify App Store.

- `pubblica` significa portare il lavoro su GitHub/main secondo
  `docs/guides/git-e-pubblicazione.md`, includendo `npm run release` quando il
  blocco `[Non rilasciato]` del changelog contiene sezioni versionate, con PR/merge o commit diretto previsto,
  controlli completi e cleanup branch/worktree locali e remoti al termine quando
  assorbito.
- `rilascia` significa usare il flusso locale `npm run release`, pubblicare la
  release su GitHub/main nello stesso flusso operativo e, per release prodotto
  reale, creare tag Git `vX.Y.Z` e GitHub Release.
- `deploya` significa aggiornare il deployment pilota Vercel production e
  verificarlo; non implica App Store, billing, tag o GitHub Release.
- tag Git `vX.Y.Z` e GitHub Release si creano per ogni release prodotto reale secondo ADR
  `docs/decisions/0008-tag-e-github-release.md`.
