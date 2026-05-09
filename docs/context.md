# Contesto progetto - SyncBay

Questo file e un handoff rapido. Per i dettagli completi vedi `syncbay-product-technical-plan.md`.

## Cos'e SyncBay

SyncBay e una Shopify app per negozianti che vendono gia su eBay.it e vogliono creare o alimentare un catalogo Shopify senza ricreare manualmente schede, immagini, prezzi e disponibilita.

La sorgente principale resta eBay. Shopify diventa una copia pulita, vendibile e controllata.

## Direzione confermata

- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: ordine Shopify pagato -> aggiornamento disponibilita eBay.
- Marketplace iniziale: eBay.it.
- Prima custom app, poi app pubblica Shopify App Store.
- Target sync: entro 5 minuti.
- Real-time dove possibile e sostenibile, senza compromettere prestazioni, rate limit, costi o stabilita.
- Scala MVP: 2.000 prodotti per shop.
- Prodotto self-service: diagnostica, retry e azioni guidate invece di supporto umano.

## Differenziazione

SyncBay non vuole essere l'ennesima app marketplace bidirezionale. La promessa e:

> SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilita sincronizzate e meno rischio di vendere prodotti non disponibili.

Tagline principale:

> Dal tuo negozio eBay a Shopify, pronto a vendere.

## Stato repo

Il repo contiene solo documentazione e fondazioni. Non esiste ancora codice applicativo.

Non creare scaffold, `package.json`, `app/`, `src/`, `prisma/` o worker senza richiesta esplicita.

## Runtime deciso

Infrastruttura MVP: Vercel + Supabase.

- Vercel: app embedded, backend HTTP, OAuth e webhook.
- Supabase Postgres: database applicativo.
- Prisma: ORM iniziale.
- Supabase Queues/Cron: job persistenti, polling e retry.
- Supabase Storage: staging privato temporaneo immagini quando serve.

Vedi ADR `decisions/0005-runtime-infrastructure.md`.

## Documenti principali

- Piano: `syncbay-product-technical-plan.md`
- Brand: `../BRAND.md`
- Roadmap: `../ROADMAP.md`
- Benchmark: `market/shopify-ebay-app-benchmark.md`
- Stack: `decisions/0001-stack.md`
- Infrastruttura runtime: `decisions/0005-runtime-infrastructure.md`
- Regole agenti: `../AGENTS.md`

## Regola di handoff

Quando si chiude un lavoro su SyncBay, indicare prossimi passi concreti se c'e un seguito operativo reale. Se non c'e, dirlo chiaramente.
