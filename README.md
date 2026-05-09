# SyncBay

SyncBay e una Shopify app per sincronizzare verso Shopify il catalogo di un negoziante eBay.it.

## Stato

Fase corrente: pianificazione e fondazioni repo.

Non e ancora presente codice applicativo. Prima dello scaffold tecnico vanno consolidati piano, stack, struttura documentale e regole operative.

## Direzione prodotto

- Shopify riceve un catalogo operativo derivato dal negozio eBay.
- eBay resta la sorgente di verita per prodotti e disponibilita.
- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: gli ordini Shopify aggiornano la disponibilita eBay per ridurre il rischio di vendere prodotti non disponibili.
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

Provisioning minimo creato:

- Vercel project: `matteos-projects-9226d217/syncbay`
- Supabase project: `SyncBay`, ref `mgjcbuokppfnglsftsmi`, region `eu-west-1`

## Documenti principali

- Piano prodotto e tecnico: `docs/syncbay-product-technical-plan.md`
- Contesto rapido: `docs/context.md`
- Indice documentazione: `docs/README.md`
- Roadmap: `ROADMAP.md`
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
- Benchmark Shopify App Store: `docs/market/shopify-ebay-app-benchmark.md`
- Regole operative Codex: `AGENTS.md`

## Prossimi passi

1. Decidere se procedere allo scaffold anche prima del keyset eBay, lasciando eBay a placeholder.
2. Creare lo scaffold Shopify CLI React Router.
3. Configurare env reali Vercel/Supabase e URL callback dopo il primo runtime utilizzabile.
