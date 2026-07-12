# AGENTS.md — servizi runtime

Queste regole valgono per `app/services/**` e integrano il file root.

## Mappa e ownership

| Superficie                                           | Owner logico                                                                                                    | Verifica minima pertinente                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sync-job-runner.server.ts`                          | claim, fairness, deadline e transizioni dei job; invoca i worker ma non sposta ownership di UI o configurazione | test puri `syncbay-runner-*`, `syncbay-job-scheduling`, `syncbay-stale-job-recovery`; poi `npm run verify:full` |
| `syncbay.server.ts`                                  | facade applicativa usata dalle route per stato, impostazioni, retry, conflitti e import                         | test puri della capability toccata, `npm run smoke:ui` quando cambia output route; poi `npm run verify:full`    |
| `shopify-draft-import.server.ts`                     | scritture prodotto/inventario/media Shopify, baseline e riuso catalogo                                          | test `syncbay-shopify-*`, import/takeover pertinenti e `npm run verify:full`                                    |
| `shopify-existing-products.server.ts`                | scansione e matching conservativo del catalogo Shopify esistente                                                | `app/services/shopify-existing-products.server.test.ts` e test takeover/matching puri                           |
| `shopify-conflict-detection.server.ts`               | letture Shopify aggregate e apertura conflitti per mapping                                                      | `app/services/shopify-conflict-detection.server.test.ts` e test conflitti puri                                  |
| `crypto.server.ts`, sessioni e adapter Shopify Admin | cifratura, refresh e accesso autenticato                                                                        | test server gemello del file e `npm run verify:full`                                                            |

## Confini da preservare

- Il runner è l'unico proprietario delle transizioni dei job in esecuzione; non
  duplicare claim, completamento o recovery in route e script.
- La logica deterministica va estratta o mantenuta in `app/lib` con test puri;
  i servizi coordinano Prisma e provider.
- Non trasformare una correzione locale in una riorganizzazione dei tre hotspot
  principali senza scope esplicito. Evita modifiche simultanee a runner,
  `syncbay.server.ts` e import se il comportamento richiesto appartiene a uno
  solo di essi.
- Per Shopify usa gli adapter e le primitive condivise già presenti; non
  introdurre fetch, retry o decifratura paralleli dentro un singolo servizio.
- Un errore provider o di una riga non deve promuovere a successo l'intero batch
  né lasciare job `RUNNING` dopo la fine della richiesta.
