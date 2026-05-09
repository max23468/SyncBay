# Decisioni aperte

Questo documento traccia decisioni non ancora chiuse. Quando una decisione diventa stabile, creare o aggiornare un ADR in `docs/decisions/` e rimuovere o archiviare la voce da qui.

## Regola

- Non trasformare una decisione aperta in codice applicativo senza conferma del maintainer.
- Se una decisione blocca lo scaffold, deve essere chiusa prima di generare runtime.
- Se una decisione puo restare differita, indicare chiaramente quale fallback vale nel MVP.

## Bloccanti prima dello scaffold

| Decisione | Stato | Default provvisorio | Perche conta |
| --- | --- | --- | --- |
| Provider hosting | Aperta | Non deciso | Influenza app URL, webhook, job queue, storage temporaneo e deploy. |
| ORM | Aperta | Prisma o Drizzle da scegliere dopo template Shopify reale | Deve aderire allo scaffold effettivo e al workflow migration. |
| Job queue | Aperta | Coda persistente obbligatoria, tecnologia non scelta | Import 2.000 prodotti e sync stock non possono dipendere da richieste sincrone. |
| Storage immagini temporanee | Aperta | Minimizzare persistenza; copiare immagini finali su Shopify | Serve decidere dove gestire download/deduplica/retry prima dell'upload Shopify. |
| Shopify dev setup | Aperta | Custom app + dev store | Servono account Partner, dev store, redirect URL e app URL. |
| eBay dev setup | Aperta | eBay.it + sandbox/production da verificare | Servono app eBay, OAuth, redirect URL e scope. |

## Decisioni da chiudere prima della beta

| Decisione | Stato | Default provvisorio | Perche conta |
| --- | --- | --- | --- |
| Billing | Aperta | Fuori dalla custom app pilota | Necessario per app pubblica Shopify App Store. |
| Piano dati/retention | Aperta | Conservare solo dati utili a sync, rollback, conflitti e compliance | Serve privacy policy reale. |
| Multi-location avanzato | Aperta | 1 location Shopify predefinita nel MVP | Impatta disponibilita e rischio di vendere prodotti non disponibili. |
| Varianti complesse | Aperta | Supporto semplice + log/esclusione guidata | Impatta import completo dei listing. |
| Matching prodotti esistenti | Aperta | Roadmap prioritaria, non MVP base | Import aggressivo potrebbe sporcare shop gia avviati. |
| Quality score | Idea | Da valutare, non MVP | Utile solo se spiega rischi concreti senza metrica opaca. |

## Decisioni da chiudere prima dell'app pubblica

| Decisione | Stato | Default provvisorio | Perche conta |
| --- | --- | --- | --- |
| Shopify App Store listing | Aperta | Dopo beta custom | Richiede contenuti, support policy, billing e review. |
| Support policy | Aperta | Self-service first | Il prodotto non deve dipendere da supporto umano nella prima fase. |
| Multi-marketplace | Idea | Fuori scope | Rischia di diluire il vantaggio eBay.it-first. |
| Release/versioning runtime | Aperta | Solo changelog docs finche non esiste runtime | Serve prima di deploy pubblici. |
