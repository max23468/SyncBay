# Modello dati concettuale

Questo documento descrive le entità previste per SyncBay e lo stato dello schema Prisma iniziale.

Lo scaffold applicativo contiene già `prisma/schema.prisma` e migration per:

- sessioni Shopify (`Session`);
- shop installati (`Shop`);
- connessione eBay per marketplace (`EbayConnection`);
- state OAuth eBay anti-CSRF (`EbayOAuthState`);
- job applicativi tracciati a database (`SyncJob`);
- audit log operativo (`AuditLog`).

Il modello resta iniziale: non include ancora mapping prodotto, snapshot persistenti, regole prezzo, regole descrizione, asset media o conflitti. La preview import ha però già una base runtime non persistente per normalizzare candidati listing e classificare errori MVP prima di qualunque scrittura Shopify.

Decisione runtime: Supabase Postgres con Prisma come ORM iniziale. Vedi ADR `docs/decisions/0005-runtime-infrastructure.md`.

## Entità principali

### Shop

Rappresenta un negozio Shopify installato su SyncBay.

Schema iniziale:

- dominio shop Shopify;
- stato installazione;
- scope Shopify concessi;
- location Shopify predefinita;
- flag sync abilitato;
- target sync in secondi;
- timestamp installazione/disinstallazione.

### Credenziali Shopify

Token e scope concessi dallo shop.

Requisiti:

- token cifrati a riposo;
- mai loggare valori;
- revoca e cleanup su disinstallazione.

### Account eBay

Account venditore collegato.

Schema iniziale:

- marketplace iniziale `EBAY_IT`;
- ambiente `sandbox`/produzione;
- user/account id eBay;
- token OAuth cifrati;
- stato connessione: attivo, scaduto, revocato, da riconnettere.

### State OAuth eBay

Traccia lo `state` temporaneo del flusso OAuth eBay.

Schema iniziale:

- shop collegato;
- hash dello state, non valore in chiaro;
- scadenza breve;
- timestamp consumo;
- eventuale URL di ritorno futuro.

### Mapping prodotto

Collega listing eBay e prodotto/variante Shopify.

Campi concettuali:

- eBay item id;
- SKU;
- Shopify product id;
- Shopify variant id;
- stato mapping;
- ultimo sync riuscito;
- ultima causa errore.

### Snapshot prodotto

Conserva confronto fra eBay, Shopify e ultimo valore scritto da SyncBay.

Serve per:

- conflitti;
- rollback;
- audit;
- evitare sovrascritture cieche.

### Regole prezzo

Regole Shopify-only.

Tipi:

- sconto percentuale;
- sconto fisso;
- markup percentuale;
- markup fisso;
- moltiplicatore;
- arrotondamento;
- prezzo minimo;
- margine minimo se esiste costo;
- compare-at price.

### Regole descrizione

Definiscono come trasformare descrizioni eBay.

Modalità:

- HTML completo;
- solo testo;
- HTML pulito con rimozione template.

### Asset media

Traccia immagini importate da eBay e caricate su Shopify.

Requisiti:

- deduplica;
- retry upload;
- errori leggibili;
- relazione immagine -> prodotto/variante.

### Job sync

Rappresenta import, sync, retry, archiviazione, update stock.

Nel runtime MVP i job applicativi sono rappresentati a livello di dominio in `SyncJob`, per diagnostica/dashboard. Supabase Queues resta il meccanismo previsto per consegna e retry persistente quando verrà attivato il runtime queue.

Stati minimi:

- pending;
- running;
- succeeded;
- failed;
- retrying;
- cancelled.

Tipi iniziali:

- import catalogo;
- sync incrementale;
- aggiornamento disponibilità eBay dopo ordine Shopify;
- rilevazione modifiche Shopify;
- archiviazione listing inattivi;
- riconciliazione catalogo;
- cleanup staging immagini.

### Conflitti

Nascono quando Shopify cambia manualmente un campo controllato da SyncBay.

Campi:

- prodotto;
- campo;
- valore eBay;
- ultimo valore scritto da SyncBay;
- valore Shopify;
- azione scelta dal negoziante.

### Audit log

Registra eventi rilevanti:

- connect/disconnect;
- refresh token fallito;
- import avviato/completato;
- sync critico fallito;
- aggiornamento disponibilità eBay fallito;
- rollback;
- conflitto risolto.

Gli eventi iniziali coprono installazione/disinstallazione Shopify, aggiornamento scope, ricezione webhook Shopify, stati connessione eBay e ciclo minimo dei job.

### Asset staging

Rappresenta eventuali immagini temporaneamente scaricate da eBay prima del caricamento su Shopify.

Requisiti:

- bucket Supabase Storage privato;
- retention breve;
- cleanup automatico;
- nessun uso come fonte immagine permanente dello shop;
- nessun dato reale in fixture, screenshot o documenti.

## Regole dati

- Ogni dato deve essere isolato per shop.
- Token cifrati a riposo.
- Nessun dato reale in test, fixture o documenti.
- Archiviazione Shopify, non cancellazione automatica, quando un listing eBay sparisce.
- Snapshot e mapping sono necessari per rollback e diagnostica.
