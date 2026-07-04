# SyncBay

SyncBay è una Shopify app per sincronizzare verso Shopify il catalogo di un negoziante eBay.it.

## Stato

Fase corrente: custom app privata 1.0 pronta per onboarding post-release su
store cliente selezionati.

Lo scaffold Shopify CLI React Router è presente. La base runtime include autenticazione Shopify, session storage Shopify locale su Prisma, app embedded SyncBay con le sei superfici `Panoramica`, `Catalogo`, `Conflitti`, `Importazione`, `Attività` e `Impostazioni`, area Impostazioni embedded per il default stato prodotti, la policy canali Shopify, la regola prezzo globale Shopify-only e la regola descrizione persistente, wizard import preview con validazioni dry-run, checklist qualità esplicita e suggerimenti conservativi di matching prodotti Shopify esistenti, lettura live eBay Inventory API per offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>` per listing storici senza SKU, fallback mock quando eBay non è collegato, modello dati iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/regole prezzo/regole descrizione/account deletion applicato su Supabase e flusso OAuth eBay verificato end-to-end. L'import controllato registra mapping, product/variant GID, snapshot, job e audit per prodotti creati o riusati; dopo creazione o riuso aggiorna titolo, descrizione, prezzo, compare-at price, SKU, stato, media, inventario Shopify dai dati eBay e dalle regole prezzo Shopify-only, e cinque faccette storefront `syncbay_facets.*` da dati strutturati e titolo eBay, poi pubblica i prodotti attivi secondo la policy canali scelta dal negoziante. L'import catalogo reale sul dev store ha completato 958 listing, sotto il limite operativo 1.0 di 2.000 prodotti, con mapping e job riusciti. Il runner HTTP protetto `/api/jobs/run-due`, collegato a Supabase Cron ogni 5 minuti in modalità risparmio egress, riprende import, pianifica sync incrementali eBay -> Shopify per shop con sync attivo o regole prezzo aggiornate, aggiorna disponibilità eBay da ordini Shopify pagati e rileva conflitti Shopify da webhook product/inventory. L'app embedded espone storico import, avanzamento ultima run, catalogo paginato, conflitti Shopify con azioni guidate, timeline attività, centro salute catalogo, stato riconciliazione completa, diagnostica rate-limit eBay, conteggi mapping/snapshot e rimessa in coda manuale dei job riprogrammabili.

## Direzione prodotto

- Shopify riceve un catalogo operativo derivato dal negozio eBay.
- eBay resta la sorgente di verità per prodotti e disponibilità.
- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: gli ordini Shopify aggiornano la disponibilità eBay per ridurre il rischio di vendere prodotti non disponibili.
- Marketplace iniziale: eBay.it.
- Distribuzione iniziale: custom app.
- Obiettivo successivo: app pubblica Shopify App Store.
- Latenza target: finestra configurabile 5-30 minuti.
- Limite operativo 1.0: 2.000 prodotti per shop.

## Stack runtime deciso

- Shopify CLI + template ufficiale React Router.
- Vercel per app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres come database.
- Prisma 7.8 come ORM.
- Supabase Queues e Supabase Cron per job, polling e retry.
- Supabase Storage privato come staging immagini temporaneo quando serve.
- Vercel Web Analytics e Speed Insights come baseline di osservabilità.

Provisioning minimo creato:

- Vercel project: `matteos-projects-9226d217/syncbay`
- Supabase project: `SyncBay`, ref `mgjcbuokppfnglsftsmi`, region `eu-west-1`

## Comandi locali

- Installazione: `npm install`
- Sviluppo Shopify: `npm run dev`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Build: `npm run build`
- Smoke UI: `npm run smoke:ui`
- Test librerie pure: `npm run test:lib`
- Coverage moduli puri target Atlas: `npm run coverage:lib`
- React Doctor: `npm run quality:react-doctor`
- Prisma/setup runtime locale: `npm run setup`
- Validazione Prisma: `npm run prisma:validate`
- Verifica advisor Supabase collegato: `npm run db:verify`
  (`SYNCBAY_SUPABASE_CWD` può forzare il checkout linkato dalle worktree)
- Coalescenza job webhook Shopify duplicati: `npm run jobs:coalesce-shopify-changes -- --shop syncbay-dev.myshopify.com`
- Migration Supabase: `npx prisma migrate deploy` da eseguire esplicitamente con `DATABASE_URL`/`DATABASE_DIRECT_URL` dell'ambiente target
- Versioning dry-run: `npm run release:dry-run`
- Preparazione release locale: `npm run release`

## Endpoint scaffold SyncBay

- About pubblico per branding eBay: `/about`
- Panoramica embedded: `/app`
- Impostazioni embedded: `/app/settings`
- Wizard import preview: `/app/import-preview`
- Avvio OAuth eBay: `/auth/ebay/start`
- Callback OAuth eBay: `/auth/ebay/callback`
- Endpoint eBay account deletion: `/ebay/account-deletion`
- Webhook Shopify configurati: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/products/update`, `/webhooks/inventory_levels/update`, `/webhooks/orders/paid`

## Documenti principali

- Piano prodotto e tecnico: `docs/syncbay-product-technical-plan.md`
- Contesto rapido: `docs/CONTEXT.md`
- Indice documentazione: `docs/INDEX.md`
- Roadmap: `docs/ROADMAP.md`
- Backlog: `docs/BACKLOG.md`
- Toolchain: `docs/TOOLCHAIN.md`
- Changelog: `CHANGELOG.md`
- Brand: `BRAND.md`
- Security policy: `SECURITY.md`
- Decisioni aperte: `docs/DECISIONS_PENDING.md`
- Checklist pre-scaffold: `docs/guides/pre-scaffold-checklist.md`
- Prerequisiti account: `docs/guides/prerequisiti-account.md`
- Provisioning runtime: `docs/guides/provisioning-runtime.md`
- Git, PR e pubblicazione: `docs/guides/git-e-pubblicazione.md`
- Versioning e release: `docs/guides/versioning-e-release.md`
- Decisione stack: `docs/decisions/0001-stack.md`
- Decisione GitHub/pubblicazione/versioning: `docs/decisions/0003-git-pubblicazione-versioning.md`
- Decisione runtime/CI/release futuri: `docs/decisions/0004-runtime-ci-release-future.md`
- Decisione infrastruttura runtime: `docs/decisions/0005-runtime-infrastructure.md`
- Decisione versioning runtime locale: `docs/decisions/0006-versioning-runtime-locale.md`
- Decisione privacy provvisoria storica: `docs/decisions/0007-privacy-provvisoria-pilota.md`
- Decisione faccette storefront importate: `docs/decisions/0016-faccette-storefront-import.md`
- Decisione retention dati operativi: `docs/decisions/0017-retention-dati-operativi.md`
- Benchmark Shopify App Store: `docs/market/shopify-ebay-app-benchmark.md`
- Regole operative Codex: `AGENTS.md`

## Prossimi passi

1. Avviare Task 10 solo dopo la release: installazione privata sul primo store
   cliente, configurazione iniziale e dry-run read-only.
2. Gestire eventuali problemi emersi nell'onboarding come patch `1.0.1+`.
3. Continuare hardening sicurezza/privacy/token/GDPR/rate limit prima di App
   Store, billing e 2.0 pubblica.
