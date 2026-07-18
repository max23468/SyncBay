# ADR 0020 - SyncBay 1.0 custom privata e catalogo Shopify esistente

> La scelta del trigger stock esclusivo `orders/paid` è sostituita dall'ADR
> 0022; il resto di questa decisione rimane valido.

- **Stato**: Accettato
- **Data**: 2026-06-21
- **Decisori**: maintainer, Codex

## Contesto

SyncBay ha superato la fase pilota tecnica: import reale, sync incrementale,
dashboard embedded, conflitti, retention, runner cron e aggiornamento stock
eBay da ordini Shopify pagati sono già presenti o verificati sul precedente ambiente pilota.

Il prossimo passo non è ancora una pubblicazione Shopify App Store. L'obiettivo
è una versione 1.0 abbastanza rifinita per essere usata su uno store Shopify
reale da uno o pochi clienti selezionati. Il primo target operativo è un catalogo
esistente già importato su Shopify da un'altra app, che alla fine del processo
verrà disattivata: SyncBay deve diventare l'unico gestore del flusso
eBay -> Shopify.

Il rischio principale è trasformare SyncBay in un tool di migrazione
Numisleo-specifico o in una suite generica di catalog migration. Questo
complicherebbe l'app oltre il suo perimetro: SyncBay deve restare eBay.it-first,
con eBay sorgente di verità e Shopify copia pulita e controllata.

## Decisione

SyncBay 1.0 è una **custom app privata** per uno o pochi clienti selezionati,
non una app pubblica Shopify App Store.

La 1.0 supporta un caso generico di prima configurazione: **collegare un
catalogo Shopify esistente a eBay** dal tab Importazione, con preview, piano di
apply, eccezioni e report. Questa capacità serve anche il primo go-live reale,
ma non deve introdurre logiche hardcoded per un singolo negozio o per una
specifica app precedente.

Il target 1.0 resta stretto:

- eBay.it come unico marketplace;
- cataloghi simili al primo target reale: numismatica e collezionismo con
  prodotti singoli;
- una sola location Shopify predefinita;
- cataloghi entro il limite operativo 1.0 di 2.000 listing attivi per shop;
- pochi clienti selezionati, con runbook e verifica manuale finale.

App Store pubblico, billing, support policy pubblica, multi-marketplace,
multi-location avanzato, varianti complesse e onboarding universale restano
fuori dalla 1.0 e appartengono a fasi successive.

## Release privata 1.0 prima dell'onboarding

SyncBay deve arrivare a `1.0.0` prima di essere installata su qualunque store
cliente. La 1.0 è una custom app privata completa e installabile, non una
release Shopify App Store pubblica.

Nessun onboarding cliente parte se i gate di release non sono verdi: Vercel
production, Supabase, privacy, termini, runbook, test locali, release locale,
tag Git e GitHub Release devono essere verificati prima dell'installazione. Il
primo onboarding reale usa la 1.0 già rilasciata; eventuali bug scoperti sul
primo cliente vengono gestiti come patch `1.0.1+`, senza ridefinire
retroattivamente il perimetro della 1.0.

Le azioni operative esposte all'operatore restano quelle generiche di SyncBay:

- `Importazione -> Collega catalogo esistente`;
- `Genera preview live`;
- `Applica takeover righe sicure`;
- `Attività -> job IMPORT_CATALOG`;
- `Catalogo -> Da controllare`;
- `Conflitti -> Batch sicuri / Da rivedere / Manuali`;
- `Impostazioni -> Sync automatico`;
- `Impostazioni -> Stato prodotti`;
- `Impostazioni -> Pubblicazioni Shopify`;
- `Impostazioni -> Regola prezzo`;
- `Impostazioni -> Regola descrizione`.

## Regole 1.0 per catalogo esistente

La nuova capacità vive nel flusso Importazione come modalità generica
**Collega catalogo esistente**.

Il matching automatico è ammesso solo con segnali forti, per esempio eBay ItemID,
SKU compatibile, metafield/tag/sorgenti della precedente app o handle
chiaramente derivato dal listing. Titolo, prezzo, immagine e categoria possono
rafforzare il match, ma non bastano da soli per collegare automaticamente un
prodotto incerto. I casi incerti finiscono in `Da rivedere`.

Per i campi controllati vale questa regola:

- se eBay restituisce un dato presente e valido, SyncBay può riallineare Shopify
  a eBay dopo preview e conferma dell'apply;
- se il dato eBay è assente, vuoto, non leggibile o non affidabile, SyncBay non
  cancella il dato Shopify: apre un'eccezione da rivedere;
- prezzo e disponibilità vengono riallineati a eBay quando i dati sono validi;
- le descrizioni vengono pulite secondo la regola descrizione SyncBay, con
  eccezione se la pulizia rischia di rimuovere contenuto utile;
- le immagini non vengono sostituite in massa: SyncBay interviene quando le
  immagini Shopify sono mancanti, rotte o chiaramente incoerenti;
- categorie Shopify, `productType` e metafield/faccette SyncBay possono essere
  applicati automaticamente dopo preview, saltando incertezze e conflitti;
- gli handle/URL Shopify esistenti vengono preservati di default. Un cambio
  handle richiede una riga esplicita nel report e deve creare redirect dal
  vecchio URL al nuovo;
- SyncBay può ripulire tag tecnici o legacy generati da app precedenti, ma deve
  preservare tag chiaramente manuali/commerciali quando non sono riconosciuti
  come sporchi;
- le regole delle collezioni automatiche esistenti restano intatte di default:
  SyncBay aggiorna i campi prodotto che alimentano le collezioni. Modificare le
  regole di collezione richiede report e approvazione esplicita.

La vecchia app può essere disattivata prima dell'apply finale, ma solo dopo:

1. audit in sola lettura;
2. dry-run SyncBay;
3. export dei segnali utili lasciati dall'app precedente;
4. finestra di freeze operativo;
5. conferma che non servono più scritture della vecchia app.

Durante il freeze non si modificano manualmente eBay o Shopify e non si
importano nuovi prodotti finché SyncBay non ha completato apply, verifica e
attivazione sync.

## Runbook takeover

Il takeover di uno store reale segue questi passaggi:

1. **Audit sola lettura**: leggere eBay, Shopify, prodotti, location,
   collezioni, tag, metafield, app precedente e segnali di matching.
2. **Dry-run**: generare piano di collegamento e riallineamento senza scritture.
3. **Export segnali legacy**: salvare fuori repo dati utili della vecchia app
   prima di disattivarla.
4. **Freeze operativo**: sospendere modifiche manuali su eBay/Shopify e nuove
   importazioni.
5. **Disattivazione vecchia app**: farlo solo dopo l'export dei segnali utili e
   solo se non servono più scritture della vecchia app.
6. **Apply SyncBay**: applicare righe sicure e registrare snapshot/audit.
7. **Verifica manuale**: controllo del maintainer/operatore su Shopify ed eBay.
8. **Attivazione ordinaria**: sync automatico eBay -> Shopify a 300 secondi e
   stock Shopify -> eBay dal ciclo ordine definito nell'ADR 0022.
9. **Monitoraggio iniziale**: controllare job, conflitti, rate-limit e ordini
   reali nella prima finestra operativa.

## Go-live e operatività

Per la 1.0 privata:

- il trigger stock Shopify -> eBay segue l'ADR 0022;
- dopo il takeover il sync automatico eBay -> Shopify parte subito;
- l'intervallo target iniziale consigliato per il catalogo è 300 secondi;
- listing eBay chiusi o inattivi restano prodotti Shopify esauriti, non
  cancellati né archiviati, secondo ADR 0011;
- la recovery 1.0 è manuale tramite snapshot, report e script interni, non
  rollback self-service prodotto-per-prodotto;
- il go-live è bloccato da conflitti critici aperti su prezzo, disponibilità o
  mapping;
- eccezioni su descrizioni, immagini, categorie/metafield sono ammesse solo se
  non compromettono la vendita e sono tracciate nel report;
- privacy policy generale SyncBay, termini d'uso minimi e mini kit per clienti
  selezionati fanno parte della readiness 1.0.

## Conseguenze

- La 1.0 resta concentrata sul prodotto core e non introduce una migrazione
  Numisleo-specifica permanente.
- Il tab Importazione diventa più utile anche per futuri clienti selezionati con
  catalogo Shopify già esistente.
- La complessità di collezioni, URL, tag e app legacy resta governata da preview,
  report e runbook, non da automazioni nascoste.
- La 2.0 resta il punto naturale per App Store pubblico, billing, support policy
  pubblica, onboarding universale e review Shopify.
- Prima di implementare serve una roadmap tecnica proporzionata che promuova
  solo le capacità generiche necessarie: matching catalogo esistente, dry-run
  applicabile, eccezioni, report e recovery manuale.

## Alternative considerate

- **Fare 1.0 come App Store readiness**: scartata perché billing, review,
  support policy pubblica e compliance pubblica cambiano il perimetro. Sarà la
  2.0.
- **Creare funzioni Numisleo-specifiche**: scartata perché complicherebbe
  SyncBay con logiche non riusabili e aumenterebbe il costo di manutenzione.
- **Sovrascrivere tutto in modo cieco**: scartata perché un dato eBay assente o
  non restituito dall'API non deve cancellare valori Shopify validi.
- **Cambiare massivamente handle/URL**: scartata come default per rischio SEO.
  I redirect sono ammessi solo per correzioni esplicite.
- **Modificare le regole collection come parte normale dell'apply**: scartata
  perché collezioni, navigazione e merchandising sono superficie store-specifica.
  Il default è alimentare le regole esistenti tramite campi prodotto corretti.

## Riferimenti

- `docs/guides/onboarding-e-import.md`
- `docs/guides/sync-engine.md`
- `docs/decisions/0011-listing-inattivo-esaurito.md`
- `docs/decisions/0019-cadenza-cron-runner.md`
- `docs/superpowers/plans/2026-06-21-syncbay-1-0-existing-catalog-takeover.md`
