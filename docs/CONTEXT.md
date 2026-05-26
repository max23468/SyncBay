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

SyncBay non vuole essere l'ennesima app marketplace bidirezionale. La promessa è:

> SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilità sincronizzate e meno rischio di vendere prodotti non disponibili.

Tagline principale:

> Dal tuo negozio eBay a Shopify, pronto a vendere.

## Stato repo

Il repo contiene documentazione, fondazioni e scaffold Shopify CLI React Router adattato a SyncBay.

Lo scaffold include `package.json`, `app/`, `prisma/`, `extensions/`, session storage Prisma, dashboard embedded SyncBay, wizard import preview con validazioni dry-run MVP, lettura live eBay Inventory API per inventory item con offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>`, fallback mock quando eBay non è collegato, gestione della location Shopify predefinita con rename dietro `write_locations`, schema iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/account deletion applicato su Supabase, webhook Shopify placeholder, flusso OAuth eBay verificato end-to-end con recupero `userId` e POST account deletion con verifica firma e cleanup dati eBay. La preview Shopify Admin e il batch draft pilota sono stati verificati sul dev store; l'import controllato registra mapping, snapshot, job e audit per bozze create o riusate, mostra lo storico import in dashboard e può rimettere in coda job riprogrammabili. Non esistono ancora import completo fino a 2.000 prodotti, sync catalogo o consumer Supabase Queues/Cron attivo.

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
- Vercel production attuale: `https://syncbay.vercel.app`; non equivale ancora a release pubblica Shopify App Store.
- eBay keyset: usare solo il keyset dedicato SyncBay; non riusare keyset di altri progetti.
- eBay OAuth: scope MVP ridotti a Identity readonly + Inventory readonly/write; verifica end-to-end completata sul runtime aggiornato.
- eBay account deletion: endpoint `/ebay/account-deletion`; challenge GET e POST con verifica `X-EBAY-SIGNATURE` implementati e test notification eBay superata. Le notifiche reali restano controllate da `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED`.
- Preview import: live via Inventory API per offer pubblicate, poi fallback Trading API `GetMyeBaySelling` + `GetItem` in sola lettura sui primi 10 listing del batch preview per listing attivi storici/Seller Hub; i listing senza SKU eBay ricevono SKU fallback `EBAY-<ItemID>`. L'import draft pilota è idempotente, registra `ProductMapping`, `ProductSnapshot`, `SyncJob` e `AuditLog`, pianifica retry con backoff sui fallimenti e mostra storico/conteggi nella dashboard.
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
- `npx prisma migrate deploy` con `DATABASE_URL`/`DATABASE_DIRECT_URL` dell'ambiente target quando bisogna applicare migration remote; su Supabase pooler può richiedere fallback SQL via `supabase db query --linked` e registrazione in `_prisma_migrations`

## Documenti principali

- Indice: `INDEX.md`
- Piano: `syncbay-product-technical-plan.md`
- Roadmap: `ROADMAP.md`
- Backlog: `BACKLOG.md`
- Toolchain: `TOOLCHAIN.md`
- Brand: `../BRAND.md`
- Benchmark: `market/shopify-ebay-app-benchmark.md`
- Stack: `decisions/0001-stack.md`
- Infrastruttura runtime: `decisions/0005-runtime-infrastructure.md`
- Versioning runtime locale: `decisions/0006-versioning-runtime-locale.md`
- Provisioning runtime: `guides/provisioning-runtime.md`
- Regole agenti: `../AGENTS.md`

## Regola di handoff

Quando si chiude un lavoro su SyncBay, indicare prossimi passi concreti se c'è un seguito operativo reale. Se non c'è, dirlo chiaramente.
