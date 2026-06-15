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

Lo scaffold include `package.json`, `app/`, `prisma/`, `extensions/`, session storage Prisma, app embedded SyncBay con sei superfici operative (`Panoramica`, `Catalogo`, `Conflitti`, `Importazione`, `Attività`, `Impostazioni`), area Impostazioni embedded per il default stato prodotti, wizard import preview con validazioni dry-run MVP, lettura live eBay Inventory API per inventory item con offer pubblicate, fallback Trading API per listing attivi storici/Seller Hub con arricchimento `GetItem` sui primi 10 listing del batch preview, SKU fallback `EBAY-<ItemID>`, fallback mock quando eBay non è collegato, gestione della location Shopify predefinita con rename dietro `write_locations`, schema iniziale per shop/account eBay/job/audit/mapping/snapshot/conflitti/account deletion applicato su Supabase, webhook Shopify operativi e flusso OAuth eBay verificato end-to-end. L'import catalogo reale sul dev store ha completato 958 listing, sotto il limite MVP di 2.000 prodotti, con mapping e job riusciti. Il runner recupera import `IMPORT_CATALOG`, pianifica sync incrementali `SYNC_INCREMENTAL` per shop con sync attivo, crea job `UPDATE_EBAY_STOCK` da `orders/paid` nel pilota custom e apre conflitti `SyncConflict` da webhook product/inventory quando Shopify diverge dall'ultimo snapshot SyncBay. L'app embedded mostra avanzamento import, catalogo paginato, immagini prodotto, timeline attività, diagnostica job e conflitti con azioni guidate; Conflitti distingue `Batch sicuri`, `Da rivedere` e `Manuali`, mentre Attività mostra impatto, prossima azione e retry sicuro dei job. Il primo ciclo incrementale reale eBay -> Shopify è stato verificato su ItemID `156986744184` con cambio quantità 3 -> 2 e rollback a 3. Il runner stock Shopify -> eBay è stato verificato sullo stesso item prima con job `UPDATE_EBAY_STOCK` sintetico e poi con trigger reale `orders/paid` da Shopify Admin `orderCreate`: la scrittura Trading API allowlistata ha ridotto eBay 3 -> 2, un secondo job duplicato è stato saltato con `already_processed`, poi eBay e Shopify sono stati ripristinati a 3 e l'allowlist Vercel è stata rimossa.

## Runtime deciso

Infrastruttura MVP: Vercel + Supabase.

- Vercel: app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres: database applicativo.
- Prisma: ORM iniziale.
- Supabase Queues/Cron: job persistenti, polling e retry.
- Supabase Storage: staging privato temporaneo immagini quando serve.
- Shopify scope media/file: `read_files` e `write_files` sono richiesti per
  riallineare i media prodotto e rimuovere media precedenti gestiti da SyncBay.
- Shopify publication: `read_publications` e `write_publications` sono richiesti
  per leggere i canali disponibili e pubblicare i prodotti attivi secondo la
  policy impostata dal negoziante.
- Shopify token offline: i job automatici usano sessioni offline a scadenza con
  refresh token; le sessioni legacy senza `expires` vanno migrate riaprendo
  l'app Shopify, non usate come fallback a durata illimitata.
- Vercel Web Analytics e Speed Insights: baseline osservabilità.
- Versioning locale corrente: `app/lib/version.ts` + `npm run release`.
  Tag `vX.Y.Z` e GitHub Release sono obbligatori per release prodotto reali
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
- Preview import: live via Inventory API per offer pubblicate, poi fallback Trading API `GetMyeBaySelling` + `GetItem` in sola lettura sui primi 10 listing del batch preview per listing attivi storici/Seller Hub; i listing senza SKU eBay ricevono SKU fallback `EBAY-<ItemID>`. L'import draft pilota è idempotente, registra `ProductMapping`, `ProductSnapshot`, `SyncJob` e `AuditLog`, salva anche `shopifyVariantGid` e valuta catalogo, applica la regola prezzo globale Shopify-only con eventuale compare-at price, riallinea lo stato dei prodotti Shopify riusati al default dello shop, pubblica i prodotti attivi secondo la policy canali Shopify dello shop, attiva e verifica tracking e quantità Shopify sulla location predefinita, pianifica retry con backoff sui fallimenti, mostra storico/conteggi nell'app embedded, recupera i retry per `ItemID` via Trading API `GetItem` ed è verificato fino a 50 prodotti. L'import completo viene pianificato in batch asincroni da Trading API fino a 2.000 listing attivi o meno se lo store collegato ne espone meno.
- Sync catalogo eBay -> Shopify: dopo l'import, il polling incrementale resta
  controllato da `syncEnabled` e target `300` secondi. Le Impostazioni embedded
  permettono di attivare/disattivare il sync automatico solo quando eBay è
  collegato, la location Shopify è impostata e ci sono prodotti importati. A
  ogni finestra il runner legge i listing eBay attivi via Trading API, pianifica
  batch `SYNC_INCREMENTAL` anche per nuovi prodotti e crea job
  `ARCHIVE_INACTIVE_LISTING` per mapping non più attivi solo quando la scansione
  eBay è completa entro il limite MVP di 2.000 prodotti. La dashboard mostra
  stato freschezza del sync, ultimo completamento e prossima finestra target.
- Stock eBay da ordini Shopify: il pilota custom riceve `orders/paid` e crea
  job prioritari `UPDATE_EBAY_STOCK`. `SYNCBAY_EBAY_STOCK_DRY_RUN=true` pianifica
  le riduzioni senza chiamare eBay e senza scrivere snapshot di stock; per
  marketplace `EBAY_IT` il runner applica solo ordini Shopify e snapshot
  catalogo in `EUR` e salta righe con valuta mancante o diversa. Il runner è
  stato verificato con payload ordine sintetico e con ordine Shopify Admin reale
  pagato tramite `orderCreate` + transazione `SALE/SUCCESS`; il parser payload
  `orders/paid` -> job stock è coperto da test locali. La readiness
  operativa si controlla con `npm run orders:paid-readiness -- --shop
  syncbay-dev.myshopify.com` e include sessione Shopify, scope ordini,
  connessione eBay `EBAY_IT`, token eBay utilizzabili, coda stock/sync e
  candidati. La sessione offline del dev store include `write_orders`; per
  nuovi test crea un solo ordine Admin con transazione `SALE/SUCCESS`, aspetta
  la consegna webhook e ripristina sempre stock e allowlist.
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
- `npm run test:lib`
- `npm run coverage:lib`
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
