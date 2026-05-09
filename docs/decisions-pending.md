# Decisioni aperte

Questo documento traccia decisioni non ancora chiuse. Quando una decisione diventa stabile, creare o aggiornare un ADR in `docs/decisions/` e rimuovere o archiviare la voce da qui.

## Regola

- Non trasformare una decisione aperta in codice applicativo senza conferma del maintainer.
- Se una decisione blocca lo scaffold, deve essere chiusa prima di generare runtime.
- Se una decisione puo restare differita, indicare chiaramente quale fallback vale nel MVP.

## Bloccanti prima dello scaffold

| Decisione | Stato | Default provvisorio | Perche conta |
| --- | --- | --- | --- |
| Env runtime e URL reali | Aperta | Vercel/Supabase provisionati; env e callback da compilare dopo scaffold | Servono URL reali, database URL e secret provider prima di usare runtime o webhook. |
| Shopify dev setup | Parziale | Account Partner, dev store, app `SyncBay` e CLI collegati; app URL/redirect da derivare da Vercel | Servono redirect URL e app URL prima dello scaffold/dev runtime. |
| eBay dev setup | Aperta | Account Developer confermato; keyset/app SyncBay richiesto a eBay; `EBAY_IT` confermato | Servono approvazione keyset, OAuth RuName, endpoint account deletion e URL OAuth. |

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
| Release/versioning runtime | Aperta | Policy docs-first in ADR 0003; niente release SemVer finche non esiste runtime | Serve prima di deploy pubblici. |
| CI runtime | Aperta | Policy futura in ADR 0004; nessun workflow Quality finche non esistono scaffold e comandi reali | Serve prima di sviluppo runtime continuativo. |
