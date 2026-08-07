# ADR 0022 - Stock eBay sul ciclo ordine Shopify

- **Stato**: Accettato
- **Data**: 2026-07-18
- **Decisori**: maintainer, Codex

## Contesto

Il trigger storico `orders/paid` proteggeva eBay solo dopo l'incasso. Shopify,
però, impegna già l'inventario quando crea un ordine confermato: un pagamento
in attesa poteva quindi lasciare lo stesso esemplare acquistabile su eBay e
generare in SyncBay un falso conflitto quantità, pur trattandosi di una
variazione prodotta dall'ordine.

## Decisione

La disponibilità eBay derivata dagli ordini segue questo ciclo:

- `orders/create` accoda subito `UPDATE_EBAY_STOCK` e sottrae la quantità
  impegnata da Shopify;
- `orders/paid` resta un recupero compatibile per webhook di creazione persi,
  ma la chiave stabile della riga ordine impedisce una seconda sottrazione;
- `orders/cancelled` può restituire la quantità sottratta dallo stesso ordine
  solo dopo aver letto le disponibilità live Shopify ed eBay.

Un ripristino non supera mai il livello precedente all'ordine, la disponibilità
live Shopify o la quantità live eBay più la riga annullata. Se manca la prova
della sottrazione originaria, una quantità provider non è leggibile oppure
Shopify non ha realmente restituito la scorta, SyncBay non aumenta eBay.

Gli eventi inventario restano segnali di rilevazione: non autorizzano da soli
una scrittura Shopify -> eBay, perché non distinguono un ordine da una modifica
manuale. Dopo la scrittura ordine, SyncBay aggiorna la baseline e risolve gli
eventuali conflitti quantità allineati.

## Conseguenze

- Gli ordini con pagamento in attesa non lasciano scorta già impegnata
  acquistabile su eBay.
- La scrittura Shopify -> eBay resta limitata alla disponibilità derivata dagli
  ordini, come richiesto dal perimetro 1.0.
- Un annullamento senza restock Shopify può lasciare temporaneamente eBay più
  prudente, ma non può creare sovravendita.
- `orders/create`, `orders/paid` e `orders/cancelled` richiedono `read_orders` e
  devono essere sottoscritti nella configurazione Shopify distribuita.

Questa ADR sostituisce soltanto la scelta del trigger esclusivo
`orders/paid` contenuta nell'ADR 0020; il resto dell'ADR 0020 rimane valido.

## Alternative considerate

- **Attendere il pagamento**: scartato perché non protegge gli ordini pendenti.
- **Scrivere eBay da ogni `inventory_levels/update`**: scartato perché
  trasformerebbe modifiche manuali Shopify in aggiornamenti silenziosi e
  violerebbe il modello dei conflitti.
- **Ripristinare sempre tutta la riga annullata**: scartato perché potrebbe
  ignorare un annullamento senza restock o una vendita eBay concorrente.

## Riferimenti

- `docs/decisions/0020-1-0-custom-privata-catalogo-esistente.md`
- `docs/guides/sync-engine.md`
- `app/lib/syncbay-order-stock.ts`
- `app/services/sync-job-stock.server.ts`
- `shopify.app.toml`
