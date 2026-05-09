# Guida architettura

Questa guida descrive l'architettura prevista. Non sostituisce l'ADR stack e non e ancora implementazione.

## Obiettivo architetturale

SyncBay deve importare e mantenere allineato un catalogo eBay.it dentro Shopify, con dashboard embedded, job asincroni, diagnostica self-service e protezione overselling.

## Componenti previsti

```text
Shopify embedded app
  -> Dashboard merchant
  -> Onboarding
  -> Conflitti
  -> Log e retry

Backend SyncBay
  -> Auth Shopify
  -> OAuth eBay
  -> API adapter Shopify
  -> API adapter eBay
  -> Sync engine
  -> Job queue
  -> Diagnostica

Database
  -> Shops
  -> Account eBay
  -> Mapping prodotti
  -> Snapshot
  -> Regole
  -> Job
  -> Conflitti
  -> Audit log

Provider esterni
  -> Shopify Admin GraphQL
  -> eBay Trading API
  -> eBay Inventory API
  -> eBay notifications dove disponibili
```

## Principi

- eBay e la sorgente di verita del catalogo.
- Shopify e la copia pulita e vendibile.
- L'eccezione al one-way sync e lo stock anti-overselling da ordini Shopify.
- Ogni job deve essere idempotente.
- Ogni errore deve diventare diagnostica utile.
- Nessuna cancellazione distruttiva automatica: archiviare e mantenere rollback dove possibile.

## Decisioni aperte

- Provider hosting.
- ORM.
- Job queue.
- Strategia storage immagini temporanee.
- Billing e distribuzione App Store.

Queste decisioni richiedono ADR dedicati quando verranno chiuse.

