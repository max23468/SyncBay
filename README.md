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
- Decisione stack: `docs/decisions/0001-stack.md`
- Benchmark Shopify App Store: `docs/market/shopify-ebay-app-benchmark.md`
- Regole operative Codex: `AGENTS.md`

## Prossimi passi

1. Preparare checklist account Shopify/eBay e credenziali necessarie.
2. Confermare prerequisiti Shopify Partner/dev store ed eBay Developer.
3. Solo dopo, creare lo scaffold applicativo.
