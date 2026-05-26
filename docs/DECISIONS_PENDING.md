# Decisioni aperte

Questo documento traccia decisioni non ancora chiuse. Quando una decisione diventa stabile, creare o aggiornare un ADR in `docs/decisions/` e rimuovere o archiviare la voce da qui.

## Regola

- Non trasformare una decisione aperta in codice applicativo senza conferma del maintainer.
- Se una decisione blocca una fase runtime, deve essere chiusa prima di implementarla.
- Se una decisione può restare differita, indicare chiaramente quale fallback vale nel MVP.

## Bloccanti prima delle prossime fasi runtime

| Decisione | Stato | Default provvisorio | Perché conta |
| --- | --- | --- | --- |
| Env runtime e URL reali | Chiusa per pilota | Vercel/Supabase provisionati, URL `https://syncbay.vercel.app` attivo, env runtime e callback eBay/Shopify configurati | Resta da decidere una policy production stabile prima di deploy pubblici o App Store. |
| Shopify dev setup | Chiuso per dev store | Account Partner, dev store, app `SyncBay`, CLI, scaffold e preview Admin verificati | Resta da definire il deploy production quando servirà. |
| eBay dev setup | Chiusa per pilota | Account Developer, keyset dedicato SyncBay, `EBAY_IT`, endpoint account deletion e OAuth end-to-end verificati | Resta da mantenere separato il keyset SyncBay da altri progetti e da decidere il percorso App Store futuro. |
| Lettura listing eBay live | Chiusa per preview pilota | Preview live collegata a Inventory API per inventory item con offer pubblicate e fallback Trading API `GetMyeBaySelling` + `GetItem` sui primi 10 listing del batch preview per listing attivi storici/Seller Hub | Verifica sullo shop pilota completata fino a 50 listing importabili. Prima dell'import completo resta da aumentare copertura e batch in modo graduale. |
| Applicazione migration import reale | Chiusa | Schema e migration mapping/snapshot/conflitti applicati su Supabase; import draft controllato da `SYNCBAY_DRAFT_IMPORT_ENABLED` e limite `SYNCBAY_DRAFT_IMPORT_LIMIT` | Le tabelle remote esistono con RLS attivo. Il batch 50 è stato verificato con import idempotente, mapping, snapshot, job e audit; il passo successivo è progettare l'estensione oltre il batch pilota. |

## Decisioni da chiudere prima della beta

| Decisione | Stato | Default provvisorio | Perché conta |
| --- | --- | --- | --- |
| Billing | Aperta | Fuori dalla custom app pilota | Necessario per app pubblica Shopify App Store. |
| Piano dati/retention | Aperta | Conservare solo dati utili a sync, rollback, conflitti e compliance | Serve privacy policy reale. |
| Verifica firma eBay account deletion | Chiusa per pilota | Challenge GET e POST con `X-EBAY-SIGNATURE`, public key eBay, idempotenza, cleanup dati, migration/deploy e test notification completati; flag runtime ancora disabilitabile | Prima dell'app pubblica serviranno privacy policy e retention dati definitive. |
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
| Release production | Aperta per App Store/production | Versioning locale attivo in ADR 0006; tag `vX.Y.Z` e GitHub Release ammessi solo per release prodotto reali secondo ADR 0008; niente Release Please | Resta da decidere policy completa di App Store, billing, supporto e promozione production. |
| CI runtime | Aperta | Policy futura in ADR 0004; nessun workflow Quality finché non vengono decisi comandi e gate reali | Serve prima di sviluppo runtime continuativo. |
