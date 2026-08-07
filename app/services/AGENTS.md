# AGENTS.md — servizi runtime

Integra il file root per `app/services/**`. Per i gate vale la riga
`app/services` di `docs/TOOLCHAIN.md`, più i test mirati del modulo toccato.

## Ownership

- `sync-job-runner.server.ts`: coordinamento sottile del tick; scheduling/claim
  e le famiglie import, incrementale, stock e conflitti vivono nei moduli
  `sync-job-*.server.ts` dedicati.
- `syncbay-state.server.ts`, `syncbay-catalog.server.ts`,
  `syncbay-import.server.ts`, `syncbay-product-updates.server.ts` e
  `syncbay-operations.server.ts`: superfici route separate per letture, catalogo,
  importazione, aggiornamenti prodotto e comandi operativi.
- `shopify-draft-import.server.ts` coordina l'import; prodotti/varianti,
  inventario, media e persistenza vivono nei rispettivi moduli
  `shopify-import-*.server.ts`.
- `shopify-existing-products.server.ts`: scansione e matching conservativo del
  catalogo Shopify esistente.
- `shopify-conflict-detection.server.ts`: letture Shopify aggregate e apertura
  conflitti per mapping.
- `crypto.server.ts`, sessioni e adapter Shopify Admin: cifratura, refresh e
  accesso autenticato.

## Confini da preservare

- Il runner è l'unico proprietario delle transizioni dei job in esecuzione: non
  duplicare claim, completamento o recovery in route e script.
- La logica deterministica sta in `app/lib` con test puri; i servizi coordinano
  Prisma e provider.
- Usa gli adapter e le primitive Shopify condivise: niente fetch, retry o
  decifratura paralleli dentro un singolo servizio.
- Un errore provider o di una singola riga non promuove a successo l'intero
  batch né lascia job `RUNNING` dopo la fine della richiesta.
- Runner e import sono gli hotspot principali: se il comportamento richiesto
  appartiene a una sola superficie, non toccare le altre.
