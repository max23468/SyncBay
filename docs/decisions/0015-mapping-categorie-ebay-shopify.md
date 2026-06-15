# ADR 0015 - Mapping categorie eBay verso Shopify

- **Stato**: Accettato
- **Data**: 2026-06-15
- **Decisori**: maintainer, Codex

## Contesto

SyncBay importa e sincronizza prodotti da eBay.it verso Shopify. eBay resta la
sorgente di verità del catalogo, ma i modelli categoria dei due provider non
coincidono:

- eBay espone categorie marketplace, categorie secondarie e categorie negozio;
- Shopify espone una sola `category` standard per prodotto, `productType`,
  collection, tag e metafield;
- la `category` Shopify richiede un ID della Standard Product Taxonomy, non un
  ID eBay.

Il repository salvava già le categorie negozio eBay nello snapshot, ma non aveva
una regola stabile per proporre categorie Shopify, `productType` o backfill sui
prodotti collegati.

## Decisione

SyncBay introduce una fondazione di mapping categorie con diagnostica, import
nuovi prodotti e backfill controllato.

Per ogni prodotto importabile o già collegato, SyncBay può produrre una proposta
categoria con:

- `shopifyCategoryGid`;
- `shopifyCategoryName`;
- `productType`;
- `confidence` (`high`, `medium`, `low`);
- `source` (`ebay_primary_category`, `ebay_store_category`, `title`,
  `fallback`);
- `applied: false`;
- `reason`.

La scrittura su Shopify è limitata a due superfici esplicite:

- nuovi prodotti creati dall'import Shopify: SyncBay passa `category` e
  `productType` a `productCreate` quando la proposta ha confidenza non bassa e
  una categoria Shopify valida;
- prodotti già collegati: SyncBay scrive solo tramite apply operativo esplicito
  dopo report/dry-run.

SyncBay non crea tag categoria.

Superfici Shopify previste dalla decisione:

- `category`: sì, su nuovi import validi e su backfill esplicito;
- `productType`: sì, su nuovi import validi e su backfill esplicito;
- metafield SyncBay/eBay: sì, per audit e report;
- tag categoria: no.

## Mappa MVP iniziale

La mappa automatica è limitata al perimetro reale eBay.it-first osservato nei
prodotti collegati, con fallback prudente: numismatica, filatelia, modellini in
scala, dischi musicali, macchine da scrivere e cataloghi/libri cartacei.

Categorie Shopify iniziali:

- `Collectible Coins & Currency`;
- `Collectible Coins`;
- `Rare Coins`;
- `Commemorative Coins`;
- `Bullion Coins`;
- `Collectible Banknotes`;
- `Postage Stamps`;
- `Single Stamps`;
- `First Day Covers`;
- `Stamp Sheets`;
- `Cars` sotto `Scale Models`;
- `Records & LPs`;
- `Typewriters`;
- `Print Books`.

Regole principali:

- categoria eBay marketplace + titolo coerente = confidenza alta;
- categoria eBay marketplace da sola = confidenza alta/media;
- categoria negozio eBay + titolo coerente = confidenza media;
- solo titolo = confidenza media/bassa e solo per casi evidenti;
- casi sconosciuti = nessuna categoria Shopify proposta, confidenza bassa;
- "oro" o "argento" non bastano per classificare una moneta come bullion;
- `Bullion Coins` vince solo se il listing segnala chiaramente bullion,
  investimento o monete da investimento;
- monete storiche/Regno/Repubblica/Vaticano restano `Rare Coins` anche se in
  oro o argento;
- i modellini auto richiedono segnali combinati di modellino/scala e veicolo;
- i dischi musicali vengono classificati come `Records & LPs` senza dedurre
  automaticamente `Vinyl`;
- le macchine da scrivere richiedono segnali espliciti come "macchina da
  scrivere" o "typewriter";
- i cataloghi/libri cartacei vengono classificati come `Print Books` solo con
  segnali titolo coerenti.

## Backfill e sovrascritture

La direzione approvata copre **tutti i prodotti collegati**, nuovi e già
sincronizzati.

Per i prodotti già collegati, il primo passo operativo è sempre un report o
dry-run con conteggi e motivi:

- prodotti aggiornabili;
- prodotti incerti;
- prodotti con categoria Shopify già presente e diversa;
- prodotti senza segnale sufficiente.

L'apply effettivo verso Shopify richiede `--apply --confirm-apply` e usa
Shopify Admin GraphQL `productUpdate` per aggiornare solo `category` e
`productType` delle righe classificate `applicable`. Un lookup Trading fallito
non blocca una proposta locale già valida; resta bloccante solo quando non c'è
una proposta abbastanza affidabile.

SyncBay non deve sovrascrivere in silenzio categorie Shopify già impostate dal
negoziante. Se la categoria Shopify esistente è diversa dalla proposta SyncBay,
la scrittura reale salta la riga come conflitto manuale; un eventuale override
richiederà una decisione separata.

## Conseguenze

- Il mapping diventa ispezionabile prima di modificare lo store.
- Il report può spiegare perché una categoria è stata proposta o scartata.
- I nuovi import nascono già con categoria Shopify quando il segnale è valido.
- Il backfill sui prodotti live resta esplicito e non massivo per default.
- La descrizione eBay non viene usata come segnale iniziale perché può contenere
  template e rumore; potrà essere rivalutata dopo osservazioni reali.
- Le collection automatiche restano fuori scope di questa decisione.

## Riferimenti

- `app/lib/syncbay-shopify-category-mapping.ts`
- `app/lib/syncbay-category-backfill-report.ts`
- `app/lib/syncbay-product-snapshot-payload.ts`
- `scripts/syncbay-category-backfill.mjs`
- `docs/syncbay-product-technical-plan.md`
- `docs/guides/onboarding-e-import.md`
- Shopify Product Taxonomy release 2026-05:
  https://shopify.github.io/product-taxonomy/releases/2026-05/
