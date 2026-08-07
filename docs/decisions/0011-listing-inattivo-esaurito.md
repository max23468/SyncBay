# ADR 0011 - Listing eBay inattivo mantenuto come esaurito su Shopify

- **Stato**: Accettato
- **Data**: 2026-06-10
- **Decisori**: maintainer, Codex

## Contesto

eBay resta la sorgente di verità del catalogo. Quando un listing eBay non è più
attivo (scansione catalogo completa che non lo trova più tra gli attivi, oppure
evento venditore con `ListingStatus` chiuso: `Completed`, `Ended`,
`EndedWithSales`, `EndedWithoutSales`, `Inactive`), SyncBay deve aggiornare la
vetrina Shopify.

Fino a questa decisione il prodotto Shopify collegato veniva portato a
`status: ARCHIVED`. Un prodotto archiviato sparisce dalla vetrina e il suo URL
non è più servito: questo produce 404 e de-indicizzazione, con perdita del
posizionamento SEO accumulato. Per un negoziante che migra un catalogo eBay
esistente su Shopify, perdere l'indicizzazione delle pagine prodotto a ogni
chiusura di inserzione è un costo concreto.

La direzione confermata dal maintainer è preservare il valore SEO delle pagine:
quando il listing eBay diventa inattivo, il prodotto deve restare su Shopify
come **esaurito**, non archiviato.

## Decisione

Quando un listing eBay diventa inattivo, SyncBay **non archivia** più il
prodotto Shopify collegato: lo mantiene `ACTIVE` e lo porta nello stato
**esaurito**.

In pratica, per il prodotto collegato:

- lo stato Shopify resta `ACTIVE`, quindi la pagina prodotto e il suo URL
  restano serviti e indicizzabili;
- la disponibilità della variante viene azzerata (scorta `0`) con tracciamento
  attivo e politica di inventario `DENY` (non vendere a scorta zero): la vetrina
  mostra "Esaurito" e non c'è rischio di vendere prodotti non disponibili;
- viene applicato il tag Shopify `esaurito` come marcatore esplicito, utile per
  filtri admin, regole di collezione e automazioni del negoziante;
- il `ProductMapping` passa al nuovo stato `OUT_OF_STOCK` (distinto da `ACTIVE`
  e da `ARCHIVED`).

**Mitigazione dati strutturati.** La disponibilità `OutOfStock` nei dati
strutturati (schema.org) è prodotta automaticamente dai temi Shopify a partire
dallo stato di disponibilità della variante (`product.available` falso quando
scorta `0` con politica `DENY`). Non serve quindi un metafield dedicato:
azzerare la scorta con `DENY` è sufficiente perché un tema standard emetta
`availability: OutOfStock`. Resta un rischio noto: prodotti esauriti in modo
permanente possono nel tempo essere declassati da Google come soft-404; la
mitigazione è mantenerli con disponibilità `OutOfStock` esplicita e, se in
futuro servirà, prevedere una scadenza che li archivi davvero.

**Rientro (listing eBay riattivato).** Se il listing torna attivo, il sync
incrementale riusa il prodotto Shopify esistente, ripristina la scorta dalla
quantità eBay e riporta il mapping ad `ACTIVE` (flusso già esistente). In più,
il riallineamento rimuove il tag `esaurito` quando presente, così il prodotto
non resta marcato come esaurito dopo il rientro.

**Naming interno.** Per limitare il raggio della modifica su un enum referenziato
e persistito, l'identificatore del job `SyncJobType.ARCHIVE_INACTIVE_LISTING` e
le relative funzioni di orchestrazione mantengono il nome storico: il loro
comportamento è ora "mettere in esaurito" il listing inattivo. Le etichette
mostrate al negoziante usano il linguaggio "esaurito". Anche lo stato UI interno
`archived` del catalogo viene riusato per la corsia "Esaurito".

## Conseguenze

- Le pagine prodotto Shopify restano vive e indicizzabili quando un listing eBay
  chiude: il valore SEO non viene perso a ogni chiusura di inserzione.
- La protezione contro la vendita di prodotti non disponibili resta garantita:
  scorta `0` con politica `DENY`.
- Lo stato `OUT_OF_STOCK` del mapping esclude il prodotto dalla riconciliazione
  catalogo e dal rilevamento conflitti (come già accadeva per `ARCHIVED`),
  evitando lavoro e falsi conflitti su un prodotto senza sorgente eBay attiva.
- I prodotti già archiviati prima di questa decisione restano archiviati: la
  migrazione è additiva e non riapre prodotti storici.
- Nasce un debito di naming controllato: alcuni identificatori interni dicono
  ancora "archive" ma marcano l'esaurito. È dichiarato qui e nei commenti.
- Va rivisto se in futuro si deciderà una scadenza oltre la quale un prodotto
  esaurito da troppo tempo viene archiviato davvero (per soft-404 a lungo
  termine): in quel caso questo ADR andrà aggiornato o sostituito.

## Alternative considerate

- **Continuare ad archiviare**: scartata perché de-indicizza le pagine prodotto
  e perde il posizionamento SEO, contro la direzione confermata.
- **Mettere il prodotto in `DRAFT`**: scartata perché anche i prodotti in bozza
  non sono serviti in vetrina, quindi non risolvono il problema SEO.
- **Metafield dedicato per i dati strutturati**: scartata per il MVP perché la
  disponibilità `OutOfStock` è già prodotta dai temi standard dallo stato di
  scorta; un metafield aggiungerebbe superficie e un passo di pulizia al rientro
  senza beneficio nel caso comune. Resta un'opzione futura per controllo SEO
  fine.
- **Rinominare l'enum `ARCHIVE_INACTIVE_LISTING`**: scartata per evitare una
  migrazione di rinomina su un enum referenziato e persistito, a fronte di un
  beneficio solo di leggibilità interna.

## Riferimenti

- `docs/guides/sync-engine.md`
- `docs/data-model.md`
- `app/services/sync-job-incremental.server.ts` (job che mette in esaurito il
  listing inattivo)
- `app/services/shopify-import-inventory.server.ts` (`markShopifyProductSoldOut`,
  rimozione marcatori al rientro)
- Shopify docs, disponibilità e politica di inventario delle varianti.
