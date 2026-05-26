# SyncBay

SyncBay è una Shopify app per sincronizzare verso Shopify il catalogo di un negoziante eBay.it.

## Stato

Fase corrente: import iniziale controllato.

Lo scaffold Shopify CLI React Router è presente. La base runtime include autenticazione Shopify, session storage Prisma, dashboard embedded SyncBay, wizard import preview con validazioni dry-run, lettura live eBay Inventory API per offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>` per listing storici senza SKU, fallback mock quando eBay non è collegato, modello dati iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/account deletion applicato su Supabase, webhook Shopify tracciati come placeholder, flusso OAuth eBay verificato end-to-end con recupero `userId` e POST eBay account deletion con verifica firma. Il batch draft pilota è stato verificato sul dev store fino a 25 prodotti e l'import registra mapping, snapshot, job e audit per bozze create o riusate; la dashboard espone storico import, conteggi mapping/snapshot e rimessa in coda manuale dei job riprogrammabili. È presente il runner HTTP protetto `/api/jobs/run-due` per riprendere job `IMPORT_CATALOG` dovuti con sessione Shopify offline, collegato a una schedule Supabase Cron ogni minuto tramite secret in Supabase Vault. Non esistono ancora import completo fino a 2.000 prodotti o sync catalogo entro 5 minuti.

## Direzione prodotto

- Shopify riceve un catalogo operativo derivato dal negozio eBay.
- eBay resta la sorgente di verità per prodotti e disponibilità.
- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: gli ordini Shopify aggiornano la disponibilità eBay per ridurre il rischio di vendere prodotti non disponibili.
- Marketplace iniziale: eBay.it.
- Distribuzione iniziale: custom app.
- Obiettivo successivo: app pubblica Shopify App Store.
- Latenza target: entro 5 minuti.
- Scala MVP: 2.000 prodotti per shop.

## Stack runtime deciso

- Shopify CLI + template ufficiale React Router.
- Vercel per app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres come database.
- Prisma come ORM iniziale.
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
- React Doctor: `npm run quality:react-doctor`
- Prisma/setup runtime locale: `npm run setup`
- Validazione Prisma: `npm run prisma:validate`
- Verifica advisor Supabase collegato: `npm run db:verify`
- Migration Supabase: `npx prisma migrate deploy` da eseguire esplicitamente con `DATABASE_URL`/`DATABASE_DIRECT_URL` dell'ambiente target
- Versioning dry-run: `npm run release:dry-run`
- Preparazione release locale: `npm run release`

## Endpoint scaffold SyncBay

- About pubblico per branding eBay: `/about`
- Dashboard embedded: `/app`
- Wizard import preview: `/app/import-preview`
- Avvio OAuth eBay: `/auth/ebay/start`
- Callback OAuth eBay: `/auth/ebay/callback`
- Endpoint eBay account deletion: `/ebay/account-deletion`
- Webhook Shopify configurati: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`, `/webhooks/products/update`, `/webhooks/inventory_levels/update`
- Webhook Shopify preparato ma non ancora configurato: `/webhooks/orders/paid`, in attesa della configurazione Shopify per protected customer data

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
- Decisioni aperte: `docs/decisions-pending.md`
- Checklist pre-scaffold: `docs/guides/pre-scaffold-checklist.md`
- Prerequisiti account: `docs/guides/prerequisiti-account.md`
- Provisioning runtime: `docs/guides/provisioning-runtime.md`
- Git, PR e pubblicazione: `docs/guides/git-e-pubblicazione.md`
- Versioning e release: `docs/guides/versioning-e-release.md`
- Decisione stack: `docs/decisions/0001-stack.md`
- Decisione GitHub/pubblicazione/versioning: `docs/decisions/0003-git-pubblicazione-versioning.md`
- Decisione runtime/CI/release futuri: `docs/decisions/0004-runtime-ci-release-future.md`
- Decisione infrastruttura runtime MVP: `docs/decisions/0005-runtime-infrastructure.md`
- Decisione versioning runtime locale: `docs/decisions/0006-versioning-runtime-locale.md`
- Decisione privacy provvisoria pilota: `docs/decisions/0007-privacy-provvisoria-pilota.md`
- Benchmark Shopify App Store: `docs/market/shopify-ebay-app-benchmark.md`
- Regole operative Codex: `AGENTS.md`

## Prossimi passi

1. Osservare i primi run Supabase Cron del runner `/api/jobs/run-due` e verificare che eventuali job `RETRYING` vengano ripresi senza duplicati.
2. Dopo batch 25 stabile, valutare il passaggio a 50 prodotti e poi il disegno dell'import completo fino a 2.000 prodotti.
3. Implementare il sync incrementale eBay -> Shopify.
4. Implementare la protezione disponibilità Shopify -> eBay per ordini pagati.
