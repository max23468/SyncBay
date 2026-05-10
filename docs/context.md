# Contesto progetto - SyncBay

Questo file è un handoff rapido. Per i dettagli completi vedi `syncbay-product-technical-plan.md`.

## Cos'è SyncBay

SyncBay è una Shopify app per negozianti che vendono già su eBay.it e vogliono creare o alimentare un catalogo Shopify senza ricreare manualmente schede, immagini, prezzi e disponibilità.

La sorgente principale resta eBay. Shopify diventa una copia pulita, vendibile e controllata.

## Direzione confermata

- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: ordine Shopify pagato -> aggiornamento disponibilità eBay.
- Marketplace iniziale: eBay.it.
- Prima custom app, poi app pubblica Shopify App Store.
- Target sync: entro 5 minuti.
- Real-time dove possibile e sostenibile, senza compromettere prestazioni, rate limit, costi o stabilità.
- Scala MVP: 2.000 prodotti per shop.
- Prodotto self-service: diagnostica, retry e azioni guidate invece di supporto umano.

## Differenziazione

SyncBay non vuole essere l'ennesima app marketplace bidirezionale. La promessa e:

> SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilità sincronizzate e meno rischio di vendere prodotti non disponibili.

Tagline principale:

> Dal tuo negozio eBay a Shopify, pronto a vendere.

## Stato repo

Il repo contiene documentazione, fondazioni e scaffold Shopify CLI React Router adattato a SyncBay.

Lo scaffold include `package.json`, `app/`, `prisma/`, `extensions/`, session storage Prisma, dashboard embedded SyncBay, wizard import preview iniziale con validazioni dry-run MVP e dati mock fittizi, gestione della location Shopify predefinita con rename dietro `write_locations`, schema iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti applicato su Supabase, webhook Shopify placeholder e flusso OAuth eBay lato app. La preview Shopify Admin è stata verificata sul dev store. Non esistono ancora import, sync catalogo o job queue runtime attivo.

## Runtime deciso

Infrastruttura MVP: Vercel + Supabase.

- Vercel: app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres: database applicativo.
- Prisma: ORM iniziale.
- Supabase Queues/Cron: job persistenti, polling e retry.
- Supabase Storage: staging privato temporaneo immagini quando serve.
- Vercel Web Analytics e Speed Insights: baseline osservabilità.
- Versioning locale: `app/lib/version.ts` + `npm run release`, senza tag o GitHub Release automatici.

Vedi ADR `decisions/0005-runtime-infrastructure.md`.

Provisioning minimo:

- Vercel project: `matteos-projects-9226d217/syncbay`.
- Supabase project ref: `mgjcbuokppfnglsftsmi`.
- Vercel production attuale: `https://syncbay.vercel.app`, ultimo deployment `READY`.
- eBay production RuName: predisposto negli env senza OAuth sul keyset provvisorio FiscalBay; non abilitarlo finché non arriva il keyset dedicato SyncBay.
- eBay account deletion: endpoint preparatorio `/webhooks/ebay/account-deletion`; challenge GET implementata, POST notifiche disabilitato finché non esiste verifica firma/cancellazione dati.
- Dettagli: `guides/provisioning-runtime.md`.

## Comandi runtime

- `npm install`
- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run smoke:ui`
- `npm run prisma:validate`
- `npm run db:verify`
- `npm run release:dry-run`
- `npx prisma migrate deploy` con `DATABASE_URL`/`DATABASE_DIRECT_URL` dell'ambiente target quando bisogna applicare migration remote; su Supabase pooler puo richiedere fallback SQL via `supabase db query --linked` e registrazione in `_prisma_migrations`

## Documenti principali

- Piano: `syncbay-product-technical-plan.md`
- Brand: `../BRAND.md`
- Roadmap: `../ROADMAP.md`
- Benchmark: `market/shopify-ebay-app-benchmark.md`
- Stack: `decisions/0001-stack.md`
- Infrastruttura runtime: `decisions/0005-runtime-infrastructure.md`
- Versioning runtime locale: `decisions/0006-versioning-runtime-locale.md`
- Provisioning runtime: `guides/provisioning-runtime.md`
- Regole agenti: `../AGENTS.md`

## Regola di handoff

Quando si chiude un lavoro su SyncBay, indicare prossimi passi concreti se c'è un seguito operativo reale. Se non c'è, dirlo chiaramente.
