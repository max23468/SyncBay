# Guida sync engine

Questa guida descrive il comportamento atteso del motore di sincronizzazione.

## Promessa

SyncBay usa una finestra target configurabile da 5 a 30 minuti, non real-time assoluto indiscriminato.

Dove il real-time o quasi real-time è tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilità, va raggiunto. Il polling configurato resta il fallback di riconciliazione.

## Sorgente di verità

- Catalogo: eBay.
- Prezzo base: eBay.
- Prezzo Shopify pubblicato: calcolato da SyncBay con regole Shopify-only.
- Disponibilità: eBay, con eccezione aggiornamento da ordini Shopify per ridurre il rischio di vendere prodotti non disponibili.
- Campi protetti Shopify: gestiti con modalità mirror controllato.

## Priorità job

1. Stock dopo ordine Shopify.
2. Quantità/prezzo eBay -> Shopify.
3. Titolo/descrizione/immagini.
4. Messa in esaurito dei prodotti con listing eBay chiuso.
5. Riconciliazione completa.

## Modalità mirror controllato

Ogni campo può essere:

- controllato da eBay;
- controllato da Shopify;
- calcolato da SyncBay;
- ignorato dal sync.

Se Shopify cambia manualmente un campo controllato da eBay o SyncBay, aprire conflitto.

## Protezione disponibilità

Default:

- trigger: ordine Shopify pagato;
- update eBay prioritario tramite job `UPDATE_EBAY_STOCK`;
- retry con backoff;
- alert critico se fallisce;
- stock buffer configurabile;
- modalità prudente se lo stock non è affidabile.

Nella custom app privata il webhook `orders/paid` salva solo riferimenti
prodotto/variante e quantità, poi il runner usa Trading API
`ReviseInventoryStatus` con ItemID e SKU del mapping SyncBay per ridurre la
disponibilità eBay.

## Sync incrementale

Per shop con sync attivo, il runner pianifica job `SYNC_INCREMENTAL` in batch da
10 ItemID. Nei cicli ordinari usa Trading API `GetSellerEvents` con una finestra
delta recente, overlap di 2 minuti e buffer finale di 2 minuti: le candidate
lette dagli eventi vengono salvate nel payload del job e riusano il flusso
import controllato senza rileggere ogni listing via `GetItem`. Gli eventi che
indicano listing conclusi o inattivi generano job `ARCHIVE_INACTIVE_LISTING`
(nome storico): il job non archivia più il prodotto Shopify ma lo mantiene in
vetrina come esaurito (scorta 0, politica `DENY`, tag `esaurito`, mapping
`OUT_OF_STOCK`) per preservarne l'indicizzazione SEO. Vedi ADR 0011. Una
finestra composta solo da messe in esaurito avanza il watermark seller-events
solo dopo il completamento dei relativi job.

`GetMyeBaySelling` resta la riconciliazione completa periodica per coprire drift,
eventi persi e nuovi stati non emersi nei delta. L'intervallo predefinito è
giornaliero ed è configurabile con
`SYNCBAY_EBAY_FULL_RECONCILE_INTERVAL_SECONDS`. Dopo una riconciliazione
completa, il watermark dei delta seller-events riparte dal timestamp della
lettura catalogo eBay, non dal completamento dei job locali. Se un job più
vecchio o un import iniziale contiene più di 10 ItemID, il runner lo spezza in
sotto-job più piccoli prima di fare chiamate Shopify/eBay pesanti. Se un mapping
ha conflitti Shopify aperti, il prodotto viene saltato finché il negoziante
sceglie un'azione guidata.

Quando una finestra delta non contiene eventi né listing inattivi, il runner usa
quel ciclo libero per riparare in modo controllato le immagini mancanti nel
Catalogo: seleziona mapping `ACTIVE` con prodotto Shopify, senza conflitti
aperti e senza thumbnail disponibile negli ultimi snapshot, poi crea job
`SYNC_INCREMENTAL` con source `catalog_image_repair`. La corsia è idempotente
per ItemID e giorno, usa lo stesso flusso media dell'import e ha limite
configurabile con `SYNCBAY_CATALOG_IMAGE_REPAIR_LIMIT` (default 20, massimo 100,
`0` per disattivarla). Il comando `npm run catalog:images:doctor` resta lo
strumento in sola lettura per misurare la copertura e capire se eBay live ora
restituisce immagini per righe ancora senza thumbnail in SyncBay.

Quando la scansione attiva eBay è completa entro il limite operativo 1.0 di 2.000
prodotti, il runner pianifica anche job `ARCHIVE_INACTIVE_LISTING` per i mapping
SyncBay ancora attivi ma non più presenti tra i listing eBay attivi: questi
prodotti vengono messi in esaurito (non archiviati), il mapping passa a
`OUT_OF_STOCK` ed esce dalla riconciliazione successiva. Se la scansione è vuota,
incompleta o troncata dal limite operativo 1.0, SyncBay sincronizza i listing letti ma non
mette in esaurito alcun prodotto Shopify per evitare falsi positivi. Se un
listing torna attivo, il sync incrementale riusa il prodotto esistente,
ripristina la scorta, riporta il mapping ad `ACTIVE` e rimuove il tag
`esaurito`.

## Conflitti Shopify

I webhook `products/update` e `inventory_levels/update` creano job
`DETECT_SHOPIFY_CHANGES`. Il runner confronta il prodotto Shopify live con
l'ultimo snapshot `SYNCBAY` e apre conflitti per titolo, descrizione, stato,
prezzo, quantità e immagini quando rileva drift.

## Riconciliazione

Il polling delta deve essere affiancato da riconciliazione completa periodica
per correggere drift, eventi persi e notifiche non ricevute.

Runtime previsto:

- Supabase Cron come scheduler primario per polling e drenaggio queue;
- Supabase Queues come coda persistente per job e retry;
- Vercel per endpoint HTTP, OAuth e webhook;
- batch piccoli e riprendibili, non funzioni lunghe monolitiche.

## Diagnostica

La dashboard deve mostrare se il sync catalogo incrementale è disattivato,
aggiornato, in corso o in ritardo rispetto al target configurato, includendo
ultimo completamento e prossima finestra prevista.

Ogni job fallito deve conservare:

- provider;
- prodotto/listing;
- operazione;
- errore normalizzato;
- impatto;
- prossima azione consigliata;
- retry sicuro si/no.

## Vincoli runtime

Il runtime 1.0 è definito in ADR `docs/decisions/0005-runtime-infrastructure.md`.

Regole per il motore sync:

- non affidare import o riconciliazioni a una singola funzione lunga;
- spezzare import e sync in batch piccoli;
- usare lock/idempotency key per evitare doppie scritture provider;
- rendere ogni job riprendibile dopo timeout, deploy o errore provider;
- conservare diagnostica e stato avanzamento per shop/prodotto/job.

Se i batch serverless non bastano, mantenere Supabase Queues/Postgres e spostare solo il consumer su worker dedicato.
