# Guida architettura

Questa guida descrive l'architettura prevista. Non sostituisce l'ADR stack e non è ancora implementazione.

## Obiettivo architetturale

SyncBay deve importare e mantenere allineato un catalogo eBay.it dentro Shopify, con dashboard embedded, job asincroni, diagnostica self-service e protezione delle disponibilità.

## Componenti previsti

```text
Shopify embedded app
  -> Dashboard negoziante
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
  -> Vercel
  -> Supabase Postgres
  -> Supabase Queues
  -> Supabase Cron
  -> Supabase Storage
  -> Shopify Admin GraphQL
  -> eBay Trading API
  -> eBay Inventory API
  -> eBay notifications dove disponibili
```

## Principi

- eBay è la sorgente di verità del catalogo.
- Shopify è la copia pulita e vendibile.
- L'eccezione al one-way sync è l'aggiornamento disponibilità da ordini Shopify.
- Ogni job deve essere idempotente.
- Ogni errore deve diventare diagnostica utile.
- Nessuna cancellazione distruttiva automatica: archiviare e mantenere rollback dove possibile.

## Decisioni infrastrutturali MVP

Vedi ADR `docs/decisions/0005-runtime-infrastructure.md`.

Scelte accettate:

- hosting app/backend HTTP: Vercel;
- database: Supabase Postgres;
- ORM: Prisma;
- queue persistente: Supabase Queues;
- scheduler: Supabase Cron;
- storage immagini temporanee: Supabase Storage privato, solo staging con retention breve;
- token provider: cifrati applicativamente prima del salvataggio su Postgres.

I job devono restare piccoli, idempotenti e riprendibili. Se il consumer queue richiede un processo persistente, spostarlo su worker dedicato Render/Fly mantenendo Vercel per app e Supabase per dati/queue.

## Decisioni ancora aperte

- Billing e distribuzione App Store.
- Ambienti production/staging e smoke test effettivi, da definire quando esiste lo scaffold.
