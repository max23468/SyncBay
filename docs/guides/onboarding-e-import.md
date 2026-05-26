# Guida onboarding e import

Questa guida definisce il flusso negoziante previsto per il MVP.

## Obiettivo

Il negoziante deve collegare Shopify ed eBay.it, vedere cosa verrà importato e avviare la creazione dei prodotti Shopify senza paura di sporcare il negozio.

## Flusso MVP

1. Installa SyncBay su Shopify.
2. Collega account eBay.it.
3. Sceglie location Shopify predefinita.
4. Lascia il default prodotti su `pubblicato` oppure seleziona `bozza` in Impostazioni.
5. Sceglie import immagini: tutte per default.
6. Sceglie modalità descrizione:
   - HTML completo;
   - solo testo;
   - HTML pulito senza template.
7. Vede preview import:
   - prodotti importabili;
   - prodotti saltati;
   - errori;
   - esempi descrizione originale/pulita;
   - stima immagini;
   - regole prezzo applicate.
8. Conferma import.
9. Vede avanzamento job e risultati.

## Stato preparatorio implementato

La dashboard embedded mostra già una readiness operativa per:

- connessione Shopify, scope e webhook pilota;
- runtime Vercel/Supabase;
- eBay OAuth verificato end-to-end sul keyset dedicato SyncBay, con recupero `userId` e token cifrati;
- endpoint account deletion con challenge, verifica firma e cleanup dati, controllato da flag runtime;
- default import e blocker della preview.

La pagina embedded `/app/import-preview` aggiunge il primo passo operativo del
wizard:

- legge le location Shopify via Admin GraphQL;
- permette di salvare una location Shopify predefinita;
- permette di rinominare la location selezionata quando lo shop ha riapprovato
  lo scope `write_locations`;
- mostra una preview live da eBay Inventory API quando l'account eBay è collegato;
- se Inventory API non restituisce prodotti importabili, prova il fallback
  Trading API `GetMyeBaySelling` e arricchisce i dettagli con `GetItem` sui
  primi 10 listing del batch preview per listing attivi storici/Seller Hub;
- genera SKU fallback `EBAY-<ItemID>` quando eBay non restituisce uno SKU del
  listing, segnalandolo come nota nella preview;
- mantiene la preview mock con dati fittizi solo quando eBay non è collegato o
  quando serve un fallback dimostrativo;
- mantiene ogni scrittura Shopify dietro conferma esplicita;
- crea o riusa prodotti Shopify in modo idempotente per eBay ItemID;
- registra mapping prodotto, snapshot e job audit per ogni prodotto gestito;
- mostra default import e sequenza di preview prevista;
- mostra conteggi dry-run, regole di validazione MVP e readiness delle fasi
  successive;
- mantiene il dry-run bloccato finché mancano account eBay collegato, location
  Shopify predefinita o lettura eBay valida.

Validazioni MVP già codificate per la preview:

- SKU mancante;
- prezzo assente o non valido;
- disponibilità assente o non leggibile;
- listing senza immagini;
- varianti troppo complesse per MVP;
- descrizione con possibile template eBay da ripulire.

La base di import Shopify in `draft` è preparata dietro feature flag:

- env: `SYNCBAY_DRAFT_IMPORT_ENABLED=false` per default;
- env: `SYNCBAY_DRAFT_IMPORT_LIMIT` per limitare il batch pilota;
- quando è `false`, la pagina mostra i blocchi ma non scrive su Shopify;
- quando è attivato, il codice usa solo item importabili della preview, fino al
  limite runtime, e crea o riusa prodotti Shopify con lo stato configurato
  nelle Impostazioni; il default runtime è `Pubblicato`, con override `Bozza`,
  insieme a titolo, descrizione HTML, tutte le immagini eBay disponibili fino al
  limite media Shopify e metadati SyncBay/eBay;
- se Shopify rifiuta una URL immagine eBay diretta, SyncBay scarica
  temporaneamente l'immagine nel bucket privato Supabase Storage
  `syncbay-import-staging`, genera una URL firmata e riprova la creazione media
  su Shopify;
- dopo creazione o riuso, SyncBay attiva il tracking scorte sull'inventory item
  Shopify, collega la variante alla location predefinita e imposta la quantità
  disponibile usando la disponibilità letta da eBay;
- sui prodotti Shopify già riusati, SyncBay riallinea anche lo stato al default
  dello shop, riallinea i media al set eBay disponibile e verifica che tracking
  e quantità impostati siano confermati da Shopify prima di marcare l'import
  come riuscito;
- ogni import crea un `SyncJob` idempotente, aggiorna `ProductMapping`, salva
  product/variant GID, snapshot `EBAY` e `SYNCBAY` e registra audit di
  avvio/esito;
- il batch 50 è stato verificato sul dev store con mapping, snapshot, job e
  audit coerenti; l'ultimo import reale ha creato 26 nuovi prodotti Shopify e ne
  ha riusate 24 senza duplicati. La schedule Supabase Cron
  `syncbay-run-due-jobs` riprende ogni minuto i job `IMPORT_CATALOG` dovuti.

Copertura attuale della preview live:

- la prima lettura usa Inventory API eBay e considera inventory item con offer
  pubblicate;
- se non emergono prodotti importabili, SyncBay usa Trading API
  `GetMyeBaySelling` in sola lettura per coprire listing attivi storici creati o
  gestiti solo da Seller Hub/UI;
- per i primi 10 listing Trading della preview, SyncBay prova `GetItem` per
  recuperare dettagli e immagini non restituiti nella lista;
- la prima pagina di preview resta limitata a 50 prodotti, entro il limite
  tecnico massimo di 100 per lettura UI. L'import completo fino a 2.000 prodotti
  richiederà batch controllati più ampi e sync incrementale.

Smoke UI locale:

- `npm run smoke:ui` verifica che dashboard, preview import e gestione location
  restino presenti nelle superfici React Router principali.

La preview import resta bloccata finché non sono disponibili:

- account eBay collegato via OAuth;
- location Shopify predefinita;
- lettura live eBay riuscita tramite Inventory API o Trading API, oppure
  fallback dimostrativo accettabile per la fase.

## Default consigliati

- Prodotti iniziali in `pubblicato`, con fallback opzionale `bozza`.
- Tutte le immagini copiate su Shopify.
- Nessuna cancellazione automatica delle immagini Shopify se eBay non restituisce
  immagini per un listing durante una lettura incompleta.
- Una sola location Shopify predefinita.
- Nessun matching automatico aggressivo con prodotti Shopify esistenti.
- Nessun publish massivo senza conferma.

## Errori da mostrare chiaramente

- account eBay non collegato;
- token scaduto;
- listing non leggibile;
- SKU mancante;
- variante troppo complessa;
- immagine non scaricabile;
- rate limit;
- errore Shopify media/prodotto.

Ogni errore deve avere impatto e prossima azione consigliata.
