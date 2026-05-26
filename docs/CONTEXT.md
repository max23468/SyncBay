# Contesto progetto - SyncBay

Questo file è un handoff rapido. Per i dettagli completi vedi `syncbay-product-technical-plan.md`.

## Stato progetto

- Fase: import iniziale controllato su scaffold Shopify CLI React Router.
- Produzione tecnica: Vercel production `https://syncbay.vercel.app`, distinta
  da release pubblica Shopify App Store.
- Source of truth operative: `AGENTS.md`, `docs/INDEX.md`, `docs/TOOLCHAIN.md`,
  `docs/DECISIONS.md` e ADR in `docs/decisions/`.

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

Lo scaffold include `package.json`, `app/`, `prisma/`, `extensions/`, session storage Prisma, dashboard embedded SyncBay, area Impostazioni embedded per il default stato prodotti, wizard import preview con validazioni dry-run MVP, lettura live eBay Inventory API per inventory item con offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>`, fallback mock quando eBay non è collegato, gestione della location Shopify predefinita con rename dietro `write_locations`, schema iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/account deletion applicato su Supabase, webhook Shopify placeholder, flusso OAuth eBay verificato end-to-end con recupero `userId` e POST account deletion con verifica firma e cleanup dati eBay. La preview Shopify Admin e l'import controllato sono verificati sul dev store fino a 50 prodotti; l'import registra mapping con product/variant GID, snapshot, job e audit per prodotti creati o riusati, attiva tracking scorte Shopify, imposta la quantità disponibile sulla location predefinita usando la quantità eBay, mostra lo storico import in dashboard, può rimettere in coda job riprogrammabili e dispone del runner protetto `/api/jobs/run-due` per job `IMPORT_CATALOG` dovuti, collegato a Supabase Cron ogni minuto tramite secret in Supabase Vault. Il batch reale già verificato da 50 listing ha creato 26 nuove bozze Shopify e ne ha riusate 24 senza duplicati; per i nuovi import il default runtime è `Pubblicato`, con override `Bozza` in `/app/settings`. Il retry automatico reale è verificato end-to-end: il runner recupera i listing richiesti via Trading API `GetItem` per `ItemID`, riusa i prodotti Shopify esistenti e chiude il job originale senza lasciarlo `RUNNING`. Il warning storico Supabase `extension_in_public` è stato chiuso spostando `pg_net` nello schema `extensions`; `net.http_post` resta disponibile per la schedule Cron. Non esistono ancora import completo fino a 2.000 prodotti o sync catalogo.

## Runtime deciso

Infrastruttura MVP: Vercel + Supabase.

- Vercel: app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres: database applicativo.
- Prisma: ORM iniziale.
- Supabase Queues/Cron: job persistenti, polling e retry.
- Supabase Storage: staging privato temporaneo immagini quando serve.
- Vercel Web Analytics e Speed Insights: baseline osservabilità.
- Versioning locale corrente: `app/lib/version.ts` + `npm run release`.
  Tag `vX.Y.Z` e GitHub Release sono ammessi solo per release prodotto reali
  secondo ADR `decisions/0008-tag-e-github-release.md`; deploy Vercel e App
  Store restano separati.

Vedi ADR `decisions/0005-runtime-infrastructure.md`.

Provisioning minimo:

- Vercel project: `matteos-projects-9226d217/syncbay`.
- Supabase project ref: `mgjcbuokppfnglsftsmi`.
- Vercel production attuale: `https://syncbay.vercel.app`; non equivale ancora a release pubblica Shopify App Store.
- eBay keyset: usare solo il keyset dedicato SyncBay; non riusare keyset di altri progetti.
- eBay OAuth: scope MVP ridotti a Identity readonly + Inventory readonly/write; verifica end-to-end completata sul runtime aggiornato.
- eBay account deletion: endpoint `/ebay/account-deletion`; challenge GET e POST con verifica `X-EBAY-SIGNATURE` implementati e test notification eBay superata. Le notifiche reali restano controllate da `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED`.
- Preview import: live via Inventory API per offer pubblicate, poi fallback Trading API `GetMyeBaySelling` + `GetItem` in sola lettura sui primi 10 listing del batch preview per listing attivi storici/Seller Hub; i listing senza SKU eBay ricevono SKU fallback `EBAY-<ItemID>`. L'import draft pilota è idempotente, registra `ProductMapping`, `ProductSnapshot`, `SyncJob` e `AuditLog`, salva anche il `shopifyVariantGid`, attiva tracking e quantità Shopify sulla location predefinita, pianifica retry con backoff sui fallimenti, mostra storico/conteggi nella dashboard, recupera i retry per `ItemID` via Trading API `GetItem` ed è verificato fino a 50 prodotti.
- Dettagli: `guides/provisioning-runtime.md`.

## Pubblicazione proporzionata

- Docs-only/governance-only: review documentale, coerenza link e
  `git diff --check`, senza smoke, deploy, release o App Store.
- Runtime/config: `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm run prisma:validate` o check mirati secondo impatto.
- Release prodotto: non confondere Vercel production con release pubblica
  Shopify App Store; tag e GitHub Release seguono ADR 0008, mentre App Store,
  billing e support policy restano decisioni separate.

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
- Tag e GitHub Release: `decisions/0008-tag-e-github-release.md`
- Decisioni stabili: `DECISIONS.md`
- Decisioni aperte: `DECISIONS_PENDING.md`
- Provisioning runtime: `guides/provisioning-runtime.md`
- Regole agenti: `../AGENTS.md`

## Regola di handoff

Quando si chiude un lavoro su SyncBay, indicare prossimi passi concreti se c'è un seguito operativo reale. Se non c'è, dirlo chiaramente.
