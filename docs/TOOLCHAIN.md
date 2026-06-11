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

Guardia locale: i checkout e i worktree SyncBay devono risolvere `node` dalla
toolchain coerente con `.node-version`, non dal Node Homebrew globale. Sulla
postazione Codex attuale l'allineamento persistente passa dagli shim `mise`; se
un comando mostra Node 26.x, fermarsi e verificare prima `command -v node`,
`node --version`, `mise current` e l'attivazione degli shim nella shell, senza
forzare installazioni o downgrade dentro la repo.

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

Per sviluppo assistito su superfici Shopify, questa postazione può usare anche
il plugin Shopify disponibile in Codex Desktop per questo tool e per questa
repo. Il plugin va considerato un supporto operativo per documentazione,
validazione e contesto Shopify, non una dipendenza runtime di SyncBay.

La postazione locale può inoltre usare Shopify AI Toolkit installato come skill
globali dell'agente:

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
| Doctor locale            | `npm run doctor:local`                                                                  |
| Preflight pubblicazione  | `npm run publish:preflight -- --remote`                                                 |
| Diagnostica job import   | `npm run jobs:status -- --shop syncbay-dev.myshopify.com`                               |
| Doctor conflitti/stale   | `npm run conflicts:doctor -- --shop syncbay-dev.myshopify.com`                          |
| Limiti eBay Trading      | `npm run ebay:rate-limits -- --shop syncbay-dev.myshopify.com`                          |
| Readiness ordini pagati  | `npm run orders:paid-readiness -- --shop syncbay-dev.myshopify.com`                     |
| Verifica campione import | `npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 10`                 |
| Riparazione prezzo/SKU   | `npm run import:repair-commercial-fields -- --shop syncbay-dev.myshopify.com --dry-run` |
| Ripristino stock eBay    | `npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write` |
| Orfani categoria negozio | `npm run ebay:store-category-orphans -- --shop syncbay-dev.myshopify.com [--limit N]`   |
| Diagnostica immagini Catalogo | `npm run catalog:images:doctor -- --shop syncbay-dev.myshopify.com [--limit N]`    |
| Test guardia stock eBay  | `npm run test:stock-guard`                                                             |
| React Doctor             | `npm run quality:react-doctor`                                                          |
| Release dry-run          | `npm run release:dry-run`                                                               |
| Release locale           | `npm run release`                                                                       |

`npm run db:verify` richiede progetto Supabase linked e credenziali disponibili. Le migration remote vanno applicate esplicitamente con `npx prisma migrate deploy` o, se il pooler blocca Prisma, con la procedura documentata in `docs/guides/provisioning-runtime.md`.
`npm run doctor:local` verifica toolchain Node/npm, `engine-strict`, file base
e presenza delle env SyncBay senza stampare valori sensibili. Usa
`--strict-env` quando stai preparando runtime live locale e vuoi bloccare anche
su env mancanti.
`npm run publish:preflight` controlla branch, worktree, changelog e script
minimi prima della pubblicazione; con `--remote` verifica anche PR GitHub e
`Codex feedback inbox`.
`npm run jobs:status` usa `supabase db query --linked` e non richiede `DATABASE_URL` locale; usa `SUPABASE_DB_PASSWORD` o il Portachiavi macOS `syncbay-supabase-db-password` quando disponibile. Evita query concorrenti ripetute perché Supabase può bloccare temporaneamente nuove connessioni dopo troppi tentativi di autenticazione.
`npm run conflicts:doctor` usa Supabase CLI linked in sola lettura per
distinguere conflitti aperti, conflitti stale, falsi positivi description
riparabili e cooldown eBay che bloccano il retry; non stampa valori prodotto o
descrizioni.
`npm run ebay:rate-limits` legge i limiti eBay Trading reali via Analytics API
per applicazione e utente, usando token eBay cifrati dal database e
client-credentials per la quota applicativa; non stampa segreti e non modifica
eBay.
`npm run orders:paid-readiness` usa lo stesso accesso Supabase in sola lettura
per verificare sessione offline Shopify, scope `read_orders`/`write_orders`,
connessione eBay `EBAY_IT`, token eBay utilizzabili, coda stock/sync e mapping
candidati con snapshot `EUR` prima di una prova reale `orders/paid`; non stampa
token, segreti o dati cliente.
`npm run import:verify` usa Supabase CLI linked più l'endpoint runtime SyncBay `/api/diagnostics/shopify-admin`, protetto da `APP_SECRET`, per confrontare un campione dell'ultima run import tra snapshot eBay/SyncBay, mapping e prodotto Shopify live senza dipendere da `shopify store auth`. Lo script legge il secret da `SYNCBAY_INTERNAL_APP_SECRET`, `APP_SECRET` o dal Portachiavi macOS `syncbay-app-secret`; la vecchia strada Shopify CLI resta solo come fallback manuale esplicito con `--shopify-source cli`.
`npm run import:repair-commercial-fields` usa gli stessi snapshot per riallineare prezzo e SKU variante Shopify quando serve riparare prodotti creati prima del fix dedicato; usa sempre `--dry-run` prima della mutation reale.
`npm run stock:restore-ebay` è una scrittura reale su eBay: richiede `--confirm-real-ebay-write`, blocca l'esecuzione se ci sono job stock/sync attivi, verifica con Trading API `GetItem` e registra uno snapshot `SYNCBAY` di ripristino.
`npm run ebay:store-category-orphans` è in sola lettura: per ogni mapping ACTIVE chiama Trading API `GetItem` e segnala i listing attivi senza categoria del negozio (quelli non visibili nella vetrina pubblica eBay, normalizzando i placeholder `0`/`-999`). Non scrive su eBay né sui dati prodotto e aggiorna solo il token eBay cifrato se scaduto; usa `--limit N` per una lista parziale rapida.
`npm run catalog:images:doctor` è in sola lettura sui listing eBay: misura la
copertura immagini degli snapshot Catalogo e chiama Trading API `GetItem` solo
per le prime righe senza immagine, così distingue listing davvero senza immagini
da prodotti candidati a backfill media. Non stampa URL, titoli o segreti e
aggiorna solo il token eBay cifrato se scaduto. La riparazione stabile vive nel
runner: quando il delta eBay è vuoto, SyncBay pianifica job `SYNC_INCREMENTAL`
con source `catalog_image_repair` per mapping attivi senza thumbnail, limitati
da `SYNCBAY_CATALOG_IMAGE_REPAIR_LIMIT`.
`npm run coverage:lib` usa solo il test runner nativo di Node e limita la coverage ai moduli puri `app/lib` già isolabili dal runtime live; la soglia Atlas corrente è `>=75%` linee e `>=65%` branch su quel perimetro.
`npm run build` esegue sempre `prisma generate` tramite `prebuild`, per mantenere il Prisma Client allineato allo schema anche nei deploy Vercel con cache installazione.

## Verifiche per tipo di modifica

| Tipo modifica                                                       | Verifiche proporzionate                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Docs-only                                                           | Review contenuto e `git diff --check`                                           |
| Runtime TypeScript/UI                                               | `npm run typecheck`, `npm run lint`, `npm run build`                            |
| Moduli puri `app/lib` o audit coverage Atlas                        | `npm run test:lib`, `npm run coverage:lib`, poi `npm run typecheck`, `npm run lint` quando pertinenti |
| Pubblicazione/merge PR                                              | `npm run doctor:local`, `npm run publish:preflight -- --remote`; aggiungere `npm run conflicts:doctor` quando il lavoro tocca conflitti, stale o retry |
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
