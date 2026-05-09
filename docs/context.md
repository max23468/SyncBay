# Contesto progetto - SyncBay

Questo file e un handoff rapido. Per i dettagli completi vedi `syncbay-product-technical-plan.md`.

## Cos'e SyncBay

SyncBay e una Shopify app per merchant che vendono gia su eBay.it e vogliono creare o alimentare uno storefront Shopify senza ricreare manualmente catalogo, immagini, prezzi e stock.

La sorgente principale resta eBay. Shopify diventa una copia pulita, vendibile e controllata.

## Direzione confermata

- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: ordine Shopify pagato -> update stock eBay.
- Marketplace iniziale: eBay.it.
- Prima custom app, poi app pubblica Shopify App Store.
- Target sync: entro 5 minuti.
- Real-time dove possibile e sostenibile, senza compromettere prestazioni, rate limit, costi o stabilita.
- Scala MVP: 2.000 prodotti per shop.
- Prodotto self-service: diagnostica, retry e azioni guidate invece di supporto umano.

## Differenziazione

SyncBay non vuole essere l'ennesima app marketplace bidirezionale. La promessa e:

> SyncBay trasforma il tuo catalogo eBay.it in uno shop Shopify pulito, sincronizzato e protetto dall'overselling.

## Stato repo

Il repo contiene solo documentazione e fondazioni. Non esiste ancora codice applicativo.

Non creare scaffold, `package.json`, `app/`, `src/`, `prisma/` o worker senza richiesta esplicita.

## Documenti principali

- Piano: `syncbay-product-technical-plan.md`
- Roadmap: `../ROADMAP.md`
- Benchmark: `market/shopify-ebay-app-benchmark.md`
- Stack: `decisions/0001-stack.md`
- Regole agenti: `../AGENTS.md`

## Regola di handoff

Quando si chiude un lavoro su SyncBay, indicare prossimi passi concreti se c'e un seguito operativo reale. Se non c'e, dirlo chiaramente.
