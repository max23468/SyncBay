# ADR 0016 - Faccette storefront importate da eBay

- **Stato**: Accettato
- **Data**: 2026-06-15
- **Decisori**: maintainer, Codex

## Contesto

SyncBay importa prodotti da eBay.it verso Shopify. Per rendere il catalogo
Shopify più navigabile, alcune informazioni merceologiche lette da eBay possono
alimentare i filtri storefront Shopify, come quelli osservati nel negozio pilota
Numisleo.

Shopify supporta filtri su metafield prodotto tramite Search & Discovery, ma:

- i filtri devono restare pochi e ad alta qualità;
- troppe varianti di valore rendono i filtri rumorosi;
- molte informazioni numismatiche osservate nel pilota sono nel titolo e non
  negli `ItemSpecifics`, quindi il titolo può essere usato solo con pattern
  chiusi e verificabili;
- le informazioni non presenti nel titolo o nei campi strutturati non vanno
  dedotte dalla descrizione o dall'assenza del campo;
- i tag prodotto non sono la superficie scelta per le faccette MVP.

## Decisione

SyncBay importa e mappa automaticamente solo cinque faccette storefront:

- `Categoria`;
- `Area / Stato`;
- `Materiale`;
- `Conservazione`;
- `Perizia`.

Le faccette vengono scritte come metafield prodotto Shopify nel namespace
`syncbay_facets`, con chiavi:

- `categoria`;
- `area_stato`;
- `materiale`;
- `conservazione`;
- `perizia`.

Le fonti sono:

- categoria negozio eBay come fonte preferita per `Categoria`;
- categoria marketplace eBay solo come fallback per `Categoria`;
- `ItemSpecifics` Trading API per `Area / Stato`, `Materiale`,
  `Conservazione` e `Perizia`;
- titolo eBay come fallback conservativo, e come raffinamento di `Area / Stato`
  quando eBay espone solo valori generici come `Italia`.

Il parser titolo è limitato a segnali espliciti:

- conservazione numismatica: `MB`, `BB`, `qBB`, `SPL`, `qSPL`, `FDC`, `qFDC`,
  `Proof`;
- materiale: `Argento`, `Bronzo`, `Oro`, `Rame`, `Ottone`, `Acmonital`,
  `Cupronichel`, `Nichel`;
- perizia: `Perizia`, `Periziata`, `Periziato`, `Certificata`,
  `Certificato`, `Cartellino`;
- area/stato: alcuni valori ricorrenti del catalogo pilota, come `Italia -
  Repubblica`, `Italia - Regno`, `Vaticano`, `Stato Pontificio`, `Germania`,
  `Regno Unito`, `Francia`, `San Marino`, `Stati Uniti`;
- categoria fallback: `Medaglie`, `Banconote`, `Francobolli`,
  `Divisionali e serie`, `Monete`.

`Perizia` viene normalizzata solo quando eBay restituisce o il titolo contiene
un valore esplicito: `Con perizia` o `Senza perizia`. Se il campo manca e il
titolo contiene solo un cognome o un indizio non esplicito, SyncBay non deduce
automaticamente `Con perizia` o `Senza perizia`.

SyncBay non crea tag categoria o tag filtro per queste faccette. La
configurazione e l'ordine dei filtri nello storefront restano competenza Shopify
Search & Discovery e del tema compatibile.

## Conseguenze

- I nuovi prodotti importati possono alimentare filtri storefront coerenti senza
  lavoro manuale prodotto per prodotto.
- Le faccette restano separate dai metafield di audit `syncbay.*` e sono pensate
  per uso storefront controllato.
- I batch asincroni conservano gli `ItemSpecifics` necessari, così le faccette
  non si perdono tra pianificazione import e creazione prodotto.
- Le faccette vengono salvate anche nello snapshot diagnostico eBay per audit e
  debug.
- I valori mancanti non vengono inventati: un filtro può quindi non coprire tutti
  i prodotti finché eBay non espone dati sufficienti o il titolo non contiene un
  segnale riconosciuto.
- Il parser titolo aumenta la copertura per il catalogo numismatico, ma resta
  una regola di prodotto da mantenere con test su titoli reali.

## Alternative considerate

- **Importare tutti gli item specifics come metafield**: scartata perché produce
  filtri rumorosi, valori non normalizzati e superficie storefront difficile da
  controllare.
- **Usare tag Shopify per le faccette**: scartata perché mischia filtri, regole
  operative e possibili automazioni negoziante; i metafield sono più espliciti.
- **Leggere anche la descrizione HTML eBay**: scartata per MVP perché può
  contenere template, testo promozionale e rumore non strutturato.
- **Parser titolo libero o AI-based**: scartato perché renderebbe i filtri poco
  prevedibili; SyncBay usa solo pattern espliciti e testati.

## Riferimenti

- `app/lib/syncbay-product-facets.ts`
- `app/services/import-preview.server.ts`
- `app/services/ebay-trading-preview.server.ts`
- `app/services/shopify-draft-import.server.ts`
- `docs/syncbay-product-technical-plan.md`
- Shopify Search & Discovery filters:
  https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-filters
