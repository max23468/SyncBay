# SyncBay

SyncBay è una Shopify app per sincronizzare verso Shopify il catalogo di un negoziante eBay.it.

## Stato

Fase corrente: import iniziale controllato.

Lo scaffold Shopify CLI React Router è presente. La base runtime include autenticazione Shopify, session storage Prisma, app embedded SyncBay con le sei superfici `Panoramica`, `Catalogo`, `Conflitti`, `Importazione`, `Attività` e `Impostazioni`, area Impostazioni embedded per il default stato prodotti e la policy canali Shopify, wizard import preview con validazioni dry-run, lettura live eBay Inventory API per offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>` per listing storici senza SKU, fallback mock quando eBay non è collegato, modello dati iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/account deletion applicato su Supabase e flusso OAuth eBay verificato end-to-end. L'import controllato registra mapping, product/variant GID, snapshot, job e audit per prodotti creati o riusati; dopo creazione o riuso aggiorna titolo, descrizione, prezzo, SKU, stato, media e inventario Shopify dai dati eBay e pubblica i prodotti attivi secondo la policy canali scelta dal negoziante. L'import catalogo reale sul dev store ha completato 958 listing, sotto il limite MVP di 2.000 prodotti, con mapping e job riusciti. Il runner HTTP protetto `/api/jobs/run-due`, collegato a Supabase Cron ogni minuto, riprende import, pianifica sync incrementali eBay -> Shopify per shop con sync attivo, aggiorna disponibilità eBay da ordini Shopify pagati e rileva conflitti Shopify da webhook product/inventory. L'app embedded espone storico import, avanzamento ultima run, catalogo paginato, conflitti Shopify con azioni guidate, timeline attività, conteggi mapping/snapshot e rimessa in coda manuale dei job riprogrammabili.

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
- Test librerie pure: `npm run test:lib`
- Coverage moduli puri target Atlas: `npm run coverage:lib`
- React Doctor: `npm run quality:react-doctor`
- Prisma/setup runtime locale: `npm run setup`
- Validazione Prisma: `npm run prisma:validate`
- Verifica advisor Supabase collegato: `npm run db:verify`
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
- Decisione infrastruttura runtime MVP: `docs/decisions/0005-runtime-infrastructure.md`
- Decisione versioning runtime locale: `docs/decisions/0006-versioning-runtime-locale.md`
- Decisione privacy provvisoria pilota: `docs/decisions/0007-privacy-provvisoria-pilota.md`
- Benchmark Shopify App Store: `docs/market/shopify-ebay-app-benchmark.md`
- Regole operative Codex: `AGENTS.md`

## Prossimi passi

1. Verificare in produzione pilota le classificazioni conflitti su coda reale.
2. Raccogliere screenshot prodotto puliti delle sei superfici embedded.
3. Estendere la diagnostica self-service verso rollback per prodotto.
4. Continuare hardening sicurezza/privacy/token/GDPR/rate limit prima di App Store e billing.
