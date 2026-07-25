# AGENTS.md — servizi runtime

Integra il file root per `app/services/**`. Per i gate vale la riga
`app/services` di `docs/TOOLCHAIN.md`, più i test mirati del modulo toccato.

## Ownership

- `sync-job-runner.server.ts`: claim, fairness, deadline e transizioni dei job.
  Invoca i worker ma non possiede UI o configurazione.
- `syncbay.server.ts`: facade usata dalle route per stato, impostazioni, retry,
  conflitti e import.
- `shopify-draft-import.server.ts`: scritture prodotto/inventario/media Shopify,
  baseline e riuso catalogo.
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
- Runner, `syncbay.server.ts` e import sono i tre hotspot: se il comportamento
  richiesto appartiene a uno solo, non toccare gli altri.
