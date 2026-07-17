# Guida service governance

Questa guida definisce limiti, comportamento operativo e responsabilità minime di SyncBay.

## Perimetro 1.0 privata

SyncBay 1.0 privata è:

- eBay.it-first;
- 1 account eBay per shop;
- 1 location Shopify predefinita;
- fino a 2.000 prodotti per shop;
- sync negozio eBay -> catalogo Shopify;
- protezione disponibilità da ordini Shopify verso eBay;
- dashboard self-service con diagnostica e retry.

## Fuori perimetro 1.0

- Supporto umano come pilastro operativo.
- Marketplace multipli.
- Multi-account eBay per shop.
- Sync bidirezionale completo.
- Gestione spedizioni/fulfillment.
- SLA formale.
- Automazioni distruttive senza rollback o archiviazione.

## Limiti operativi

| Area             | Limite 1.0                                                     | Azione se il limite viene superato                   |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Catalogo         | 2.000 prodotti per shop                                        | Bloccare import o richiedere piano Growth.           |
| Account eBay     | 1 per shop                                                     | Rimandare multi-account a decisione post-1.0.        |
| Location Shopify | 1 predefinita                                                  | Mostrare limite in onboarding.                       |
| Sync             | Finestra configurabile 5-30 minuti; real-time dove sostenibile | Usare polling come fallback obbligatorio.            |
| Errori ordinari  | Self-service                                                   | Mostrare causa, impatto, retry e azione consigliata. |
| Supporto umano   | Non previsto come requisito 1.0                                | Progettare diagnostica e runbook interno.            |

## Retention operativa

Da rivalutare prima di App Store, billing o distribuzione pubblica:

- conservare mapping e snapshot finché lo shop usa SyncBay;
- conservare job e audit log per il tempo necessario a diagnostica, rollback e compliance;
- eliminare o anonimizzare dati shop su disinstallazione/richiesta dove richiesto;
- non conservare payload completi sensibili se bastano riferimenti diagnostici;
- non salvare dati cliente/ordine oltre quanto necessario a proteggere la disponibilità.

## Comportamento in caso di errore

### Errore sync catalogo

- Non sovrascrivere dati in modo incerto.
- Segnare prodotto/job come fallito.
- Mostrare errore in dashboard.
- Permettere retry se sicuro.
- Mantenere ultimo stato Shopify valido.

### Errore disponibilità eBay dopo ordine Shopify

- Trattare come alert critico.
- Retry prioritario.
- Mostrare impatto e prodotto coinvolto.
- Se configurato, attivare modalità prudente sul prodotto Shopify.
- Non nascondere il rischio di vendere prodotti non disponibili.

### Listing eBay non più attivo

- Mantenere il prodotto Shopify in vetrina come esaurito.
- Non cancellare automaticamente.
- Conservare mapping/snapshot per audit e rollback.

## Modalità prudente

La modalità prudente serve quando SyncBay non è sicuro dello stock.

Possibili azioni configurabili:

- ridurre quantità Shopify pubblicata;
- applicare stock buffer;
- mettere prodotto in draft/archiviato in casi critici;
- bloccare ulteriori sync su un campo finché il conflitto non viene risolto.

## Requisiti 1.0 privata

- Informativa privacy 1.0.
- Security note aggiornata.
- Disinstallazione Shopify gestita.
- eBay account deletion notification o opt-out corretto.
- Audit log minimo.
- Dashboard errori comprensibile.
- Rollback import.
