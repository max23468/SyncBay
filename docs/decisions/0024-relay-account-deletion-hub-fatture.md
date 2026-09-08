# ADR 0024 - Relay account deletion verso Hub Fatture

- **Stato**: Accettato
- **Data**: 2026-09-08
- **Decisori**: maintainer, Codex

## Contesto

Hub Fatture usa il keyset eBay di SyncBay per le letture degli ordini. eBay
associa la configurazione marketplace account deletion al keyset e ammette un
solo endpoint canonico, già ospitato da SyncBay. Entrambe le applicazioni
conservano dati soggetti alla stessa notifica e devono completare il proprio
trattamento prima che eBay riceva una risposta positiva.

## Decisione

SyncBay resta l'endpoint canonico eBay. Verifica firma e payload, applica la
pulizia locale idempotente e salva cifrati il corpo e l'header
`X-EBAY-SIGNATURE` originali prima di rispondere `204`. Il runner esistente
inoltra l'envelope a Hub Fatture con retry senza limite; dopo una risposta `2xx`
cancella immediatamente i due valori cifrati.

La destinazione HTTPS vive in `HUB_FATTURE_EBAY_ACCOUNT_DELETION_URL`. Il relay
non persiste payload raw in chiaro e riusa tabella, cifratura, cron e runner già
presenti. I retry sono sicuri perché i due ricevitori sono idempotenti.

Il relay non introduce un OAuth o un RuName dedicato a Hub Fatture. Resta un solo
consenso sul RuName SyncBay; i relativi scope includono
`sell.fulfillment.readonly` affinché il token risultante possa servire anche le
letture ordini di Hub Fatture.

## Conseguenze

- SyncBay conferma subito a eBay la custodia durevole della notifica e completa
  separatamente il trattamento di Hub Fatture.
- Un'indisponibilità temporanea di Hub Fatture mantiene il relay in retry e non
  ripete gli effetti locali già conclusi.
- Il keyset, gli scope, la configurazione account deletion e i relativi limiti
  applicativi diventano una dipendenza condivisa tra SyncBay e Hub Fatture.
- Se nasceranno altri consumatori, servirà modellare destinazioni separate.

## Alternative considerate

- **Endpoint Hub Fatture diretto**: sostituirebbe quello SyncBay e Hub Fatture
  non espone la challenge GET richiesta da eBay.
- **Relay sincrono prima del `204`**: le fonti eBay descrivono finestre di retry
  non uniformi e richiedono una risposta immediata; un guasto prolungato di Hub
  Fatture potrebbe bloccare o esaurire la consegna provider.
- **Relay FiscalBay**: manterrebbe Hub Fatture legato al keyset precedente e non
  coprirebbe le notifiche del keyset SyncBay.

## Riferimenti

- `app/routes/webhooks.ebay.account-deletion.tsx`
- `app/services/ebay-account-deletion.server.ts`
- `docs/guides/prerequisiti-account.md`
- https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion
