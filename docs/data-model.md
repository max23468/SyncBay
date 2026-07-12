# Modello dati concettuale

Questo documento descrive le entità previste per SyncBay e lo stato dello schema Prisma iniziale.

Lo scaffold applicativo contiene già `prisma/schema.prisma` e migration per:

- sessioni Shopify (`Session`);
- shop installati (`Shop`);
- connessione eBay per marketplace (`EbayConnection`);
- state OAuth eBay anti-CSRF (`EbayOAuthState`);
- job applicativi tracciati a database (`SyncJob`);
- audit log operativo (`AuditLog`);
- mapping prodotto eBay -> Shopify (`ProductMapping`);
- snapshot prodotto (`ProductSnapshot`);
- baseline prodotto durevole (`ProductSyncBaseline`);
- checkpoint settimanali compatti (`ProductSnapshotCheckpoint`);
- registro maintenance idempotente (`MaintenanceRun`);
- conflitti Shopify (`SyncConflict`);
- richieste eBay marketplace account deletion (`EbayAccountDeletionRequest`);
- regola descrizione persistente per shop (`DescriptionRule`).

Il modello resta iniziale: include mapping, snapshot, conflitti, una regola
prezzo globale per shop e una regola descrizione globale per shop, ma non
include ancora regole prezzo per categoria o asset media dedicati. La preview
import normalizza candidati listing e classifica errori 1.0; l'import controllato
registra già `ProductMapping`, `ProductSnapshot`, `SyncJob` e `AuditLog` per
prodotti Shopify creati o riusati, includendo product GID, variant GID, stato
dell'allineamento scorte, prezzo Shopify calcolato e diagnostica del
riallineamento immagini scritto da SyncBay.

### Storia prodotto e baseline durevole

`ProductSyncBaseline` è lo stato corrente per mapping usato da rilevamento
conflitti e viste operative. Le patch seguono la semantica `undefined =
preserva`, `null = cancella`, valore = aggiorna. Durante il rollout additivo ogni
writer salva baseline e snapshot nella stessa transazione; i reader mantengono
temporaneamente il fallback alle snapshot finché il backfill non copre tutti i
mapping attivi.

`ProductSnapshot` conserva gli eventi densi per 30 giorni.
`ProductSnapshotCheckpoint` conserva per 180 giorni al massimo un checkpoint
per mapping, sorgente e settimana UTC, soltanto quando lo stato cambia. Il campo
`isComplete` impedisce di cancellare la snapshot sorgente quando i dati
reversibili non entrano nel limite di 64 KiB. La timeline diagnostica unisce
eventi recenti e checkpoint senza confonderli con la baseline corrente.

`MaintenanceRun` rende la maintenance una volta al giorno anche se il runner la
richiama a ogni tick. Il kill switch
`SYNCBAY_RETENTION_CLEANUP_ENABLED=false` blocca tutte le cancellazioni ma non
le letture delle baseline.

Decisione runtime: Supabase Postgres con Prisma come ORM iniziale. Vedi ADR `docs/decisions/0005-runtime-infrastructure.md`.

## Entità principali

### Shop

Rappresenta un negozio Shopify installato su SyncBay.

Schema iniziale:

- dominio shop Shopify;
- stato installazione;
- scope Shopify concessi;
- location Shopify predefinita;
- stato prodotto predefinito per import/sync;
- policy pubblicazione canali Shopify e, quando serve, GID canali selezionati;
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

### Richieste account deletion eBay

Traccia in modo minimizzato le notifiche eBay marketplace account deletion.

Schema iniziale:

- `notificationId` univoco per idempotenza;
- `hashedUserId` calcolato con HMAC applicativo, senza salvare il `userId` raw;
- stato processing/processed/no match/failed;
- conteggio shop corrispondenti;
- key id usato per la firma eBay;
- date evento/pubblicazione se presenti;
- nessun salvataggio di `username`, `eiasToken` o payload raw.

### Mapping prodotto

Collega listing eBay e prodotto/variante Shopify.

Schema iniziale:

- eBay item id;
- SKU;
- Shopify product id;
- Shopify variant id;
- Shopify inventory item GID nullable, univoco per shop e indicizzato per il
  lookup diretto dei webhook `inventory_levels/update`;
- stato mapping (`ACTIVE`, `OUT_OF_STOCK`, `ARCHIVED`, `PAUSED`, `ERROR`);
- ultimo sync riuscito;
- ultima causa errore.

Stato `OUT_OF_STOCK`: il listing eBay è diventato inattivo e il prodotto Shopify
è mantenuto in vetrina come esaurito (scorta 0, politica `DENY`, tag `esaurito`)
invece di essere archiviato, per preservarne l'indicizzazione SEO. Il GID
inventory viene scritto durante import/sync quando Shopify lo restituisce e
può essere recuperato dagli snapshot storici con il backfill dry-run/apply;
una collisione viene sempre saltata. Esce dalla
riconciliazione e dal rilevamento conflitti; torna `ACTIVE` se il listing eBay
viene riattivato. Vedi ADR 0011.

### Snapshot prodotto

Conserva confronto fra eBay, Shopify e ultimo valore scritto da SyncBay.

Serve per:

- conflitti;
- rollback;
- audit;
- evitare sovrascritture cieche.

Schema iniziale:

- fonte snapshot: eBay, Shopify o SyncBay;
- riferimenti mapping/listing/prodotto/variante;
- SKU, titolo, prezzo, valuta, quantità, stato prodotto;
- hash descrizione, conteggio immagini e payload diagnostico.
- proposta categoria Shopify quando disponibile: categoria eBay
  marketplace/negozio, categoria Shopify candidata, `productType`, confidenza,
  sorgente e motivo; il dato resta diagnostico nei payload, viene usato sui
  nuovi `productCreate` quando valido e abilita l'apply categorie esplicito sui
  prodotti già collegati.
- faccette storefront dedotte da SyncBay: `Categoria`, `Area / Stato`,
  `Materiale`, `Conservazione`, `Perizia`. Ogni inferenza mantiene valore,
  confidenza, fonte, evidenza e `ruleId`. Solo le inferenze ad alta confidenza
  vengono trasformate in `productFacets` e scritte su Shopify come metafield
  prodotto `syncbay_facets.*`. I baseline per proteggere modifiche manuali
  devono essere letti solo da snapshot che contengono davvero `productFacets`:
  snapshot `EBAY` come baseline storica dell'import e snapshot `SYNCBAY` creati
  dopo scritture automatiche riuscite. Il runner automatico preserva il baseline
  writer-owned quando l'evidenza manca temporaneamente; eventuali cancellazioni
  di faccette richiedono un percorso esplicito e non derivano dalla sola assenza
  di dati grezzi in un batch.

### Regole prezzo

Regole Shopify-only.

Schema iniziale:

- una regola globale per shop;
- sconto percentuale intero `0-90`, dove `0` mantiene il prezzo eBay;
- arrotondamento a due decimali o all'euro;
- compare-at price Shopify valorizzato con il prezzo eBay originale quando lo
  sconto è attivo.

Restano previste come evoluzioni: sconto fisso, markup, moltiplicatore, prezzo
minimo, margine minimo e regole per categoria.

### Regole descrizione

Definiscono come trasformare descrizioni eBay.

Schema iniziale:

- una regola globale per shop;
- modalità `CLEAN_HTML`, `FULL_HTML` o `TEXT_ONLY`;
- default `CLEAN_HTML`, per rimuovere template eBay mantenendo contenuto utile;
- applicazione ai nuovi import e alle anteprime successive, senza riscrittura
  automatica dei prodotti già pubblicati.

Modalità:

- HTML completo;
- solo testo;
- HTML pulito con rimozione template.

### Asset media

Traccia immagini importate da eBay e caricate su Shopify.

Nel runtime attuale non esiste ancora una tabella dedicata `MediaAsset`: lo stato
media dell'import viene salvato nel payload diagnostico degli snapshot
`SYNCBAY` e nel risultato del job. La tabella dedicata resta utile quando
serviranno retry granulari, cleanup e relazione immagine -> variante.

Requisiti:

- deduplica;
- retry upload;
- errori leggibili;
- relazione immagine -> prodotto/variante.

### Job sync

Rappresenta import, sync, retry, archiviazione, update stock.

Nel runtime 1.0 i job applicativi sono rappresentati a livello di dominio in `SyncJob`, per diagnostica/dashboard. Supabase Queues resta il meccanismo previsto per consegna e retry persistente quando verrà attivato il runtime queue.

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

Schema iniziale:

- stato conflitto: aperto, risolto, ignorato;
- risoluzione scelta: mantieni Shopify, riallinea da eBay, ignora campo;
- valori eBay, ultimo valore scritto da SyncBay e valore Shopify.

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
- Messa in esaurito su Shopify, non cancellazione automatica, quando un listing eBay sparisce.
- Snapshot e mapping sono necessari per rollback e diagnostica.
- Retention operativa secondo ADR 0017: audit log 180 giorni, job 90 giorni,
  snapshot 180 giorni, state OAuth 7 giorni e richieste eBay account deletion
  365 giorni.
