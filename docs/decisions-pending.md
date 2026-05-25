# Decisioni aperte

Questo documento traccia decisioni non ancora chiuse. Quando una decisione diventa stabile, creare o aggiornare un ADR in `docs/decisions/` e rimuovere o archiviare la voce da qui.

## Regola

- Non trasformare una decisione aperta in codice applicativo senza conferma del maintainer.
- Se una decisione blocca una fase runtime, deve essere chiusa prima di implementarla.
- Se una decisione può restare differita, indicare chiaramente quale fallback vale nel MVP.

## Bloccanti prima delle prossime fasi runtime

| Decisione | Stato | Default provvisorio | Perché conta |
| --- | --- | --- | --- |
| Env runtime e URL reali | Aperta | Vercel/Supabase provisionati; scaffold presente; env e callback da compilare sul primo runtime utilizzabile | Servono URL reali, database URL e secret provider prima di usare runtime o webhook. |
| Shopify dev setup | Chiuso per dev store | Account Partner, dev store, app `SyncBay`, CLI, scaffold e preview Admin verificati | Resta da definire il deploy production quando servirà. |
| eBay dev setup | Aperta | Account Developer confermato; keyset/app dedicato SyncBay ricevuto; `EBAY_IT` confermato; endpoint account deletion configurato | Servono deploy/migration runtime aggiornato, test notification eBay e OAuth end-to-end sul keyset dedicato. |
| Lettura listing eBay live | Bloccata da OAuth eBay end-to-end | Validazioni preview e readiness dry-run implementate senza chiamate live | Non va collegata una lettura reale Trading/Inventory API finché OAuth dedicato SyncBay non è verificato end-to-end. |
| Applicazione migration import reale | Chiusa | Schema e migration mapping/snapshot/conflitti applicati su Supabase; import draft ancora disabilitato | Le tabelle remote esistono con RLS attivo. Prima di creare bozze Shopify serve scegliere una verifica pilota e abilitare esplicitamente `SYNCBAY_DRAFT_IMPORT_ENABLED`. |

## Decisioni da chiudere prima della beta

| Decisione | Stato | Default provvisorio | Perché conta |
| --- | --- | --- | --- |
| Billing | Aperta | Fuori dalla custom app pilota | Necessario per app pubblica Shopify App Store. |
| Piano dati/retention | Aperta | Conservare solo dati utili a sync, rollback, conflitti e compliance | Serve privacy policy reale. |
| Verifica firma eBay account deletion | Chiusa lato codice | Challenge GET e POST con `X-EBAY-SIGNATURE`, public key eBay, idempotenza e cleanup dati implementati; flag runtime ancora disabilitabile | Prima di notifiche reali servono migration/deploy e test notification dal portale eBay. |
| Multi-location avanzato | Aperta | 1 location Shopify predefinita nel MVP | Impatta disponibilità e rischio di vendere prodotti non disponibili. |
| Varianti complesse | Aperta | Supporto semplice + log/esclusione guidata | Impatta import completo dei listing. |
| Matching prodotti esistenti | Aperta | Roadmap prioritaria, non MVP base | Import aggressivo potrebbe sporcare shop già avviati. |
| Quality score | Idea | Da valutare, non MVP | Utile solo se spiega rischi concreti senza metrica opaca. |

## Decisioni da chiudere prima dell'app pubblica

| Decisione | Stato | Default provvisorio | Perché conta |
| --- | --- | --- | --- |
| Shopify App Store listing | Aperta | Dopo beta custom | Richiede contenuti, support policy, billing e review. |
| Support policy | Aperta | Self-service first | Il prodotto non deve dipendere da supporto umano nella prima fase. |
| Multi-marketplace | Idea | Fuori scope | Rischia di diluire il vantaggio eBay.it-first. |
| Release production | Aperta | Versioning locale attivo in ADR 0006; niente tag, GitHub Release o Release Please finché non viene deciso il deploy production | Serve prima di deploy pubblici versionati. |
| CI runtime | Aperta | Policy futura in ADR 0004; nessun workflow Quality finché non vengono decisi comandi e gate reali | Serve prima di sviluppo runtime continuativo. |
