# Modello dati concettuale

Questo documento descrive le entita previste per SyncBay. Non e ancora uno schema database definitivo.

Quando verra creato lo scaffold applicativo, questo documento dovra essere riallineato a migration, ORM e schema reale.

Decisione runtime: Supabase Postgres con Prisma come ORM iniziale. Vedi ADR `docs/decisions/0005-runtime-infrastructure.md`.

## Entita principali

### Shop

Rappresenta un negozio Shopify installato su SyncBay.

Campi concettuali:

- dominio shop Shopify;
- stato installazione;
- piano/profilo prodotto;
- preferenze sync;
- location Shopify predefinita;
- timestamp installazione/disinstallazione.

### Credenziali Shopify

Token e scope concessi dallo shop.

Requisiti:

- token cifrati a riposo;
- mai loggare valori;
- revoca e cleanup su disinstallazione.

### Account eBay

Account venditore collegato.

Campi concettuali:

- marketplace iniziale `EBAY_IT`;
- user/account id eBay;
- token OAuth cifrati;
- stato connessione: attivo, scaduto, revocato, da riconnettere.

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

Modalita:

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

Nel runtime MVP i job applicativi dovranno essere rappresentati sia a livello di dominio, per diagnostica/dashboard, sia su Supabase Queues, per consegna e retry persistente.

Stati minimi:

- pending;
- running;
- succeeded;
- failed;
- retrying;
- cancelled.

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
- aggiornamento disponibilita eBay fallito;
- rollback;
- conflitto risolto.

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
