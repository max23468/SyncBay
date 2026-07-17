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

Le fonti vengono valutate in questo ordine:

- titolo eBay, tramite regole deterministiche SyncBay con lista chiusa di
  pattern testati;
- categoria negozio eBay e categoria marketplace eBay come indizi per
  `Categoria`, non come fonte esaustiva;
- metafield Shopify esistenti e ultimo snapshot SyncBay come baseline per
  proteggere modifiche manuali;
- `ItemSpecifics` Trading API solo come fonte opportunistica quando presenti e
  coerenti con le regole SyncBay.

SyncBay scrive automaticamente solo valori ad alta confidenza. I valori a
confidenza media restano inferenze diagnostiche in memoria durante il calcolo,
ma in questa implementazione non vengono scritti né persistiti come storefront:
potranno diventare diagnostica persistita solo con una decisione UI dedicata.
I valori a bassa confidenza non vengono scritti.

Quando il runner automatico trova un baseline SyncBay precedente ma nel batch
corrente non riesce a ricostruire la stessa evidenza, conserva la faccetta
writer-owned invece di cancellare il metafield Shopify. Le cancellazioni di
faccette devono passare da un percorso esplicito e non dalla sola assenza di un
campo grezzo in eBay o nello snapshot.

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

L'obiettivo non è compilare sempre tutte le faccette. L'obiettivo è compilare
solo i valori che SyncBay può difendere con evidenza leggibile: token, frase,
categoria sorgente o regola applicata. Se l'evidenza manca, il metafield resta
assente.

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
- I prodotti già collegati possono essere allineati con
  `npm run facets:backfill`: dry-run di default, apply solo con
  `--apply --confirm-apply`, scrittura Shopify tramite `metafieldsSet` e nessuna
  attivazione automatica dei filtri storefront.
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
- `scripts/syncbay-product-facets-backfill.mjs`
- `docs/syncbay-product-technical-plan.md`
- Shopify Search & Discovery filters:
  https://help.shopify.com/en/manual/online-store/storefront-search/search-and-discovery-filters
