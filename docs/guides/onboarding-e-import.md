# Guida onboarding e import

Questa guida definisce il flusso negoziante previsto per la 1.0 privata.

## Obiettivo

Il negoziante deve collegare Shopify ed eBay.it, vedere cosa verrà importato e avviare la creazione dei prodotti Shopify senza paura di sporcare il negozio.

## Flusso 1.0

1. Installa SyncBay su Shopify.
2. Collega account eBay.it.
3. Sceglie location Shopify predefinita.
4. Lascia il default prodotti su `pubblicato` oppure seleziona `bozza` in Impostazioni.
5. Sceglie import immagini: tutte per default.
6. Sceglie modalità descrizione:
   - HTML completo;
   - solo testo;
   - HTML pulito senza template e colori.
7. Vede preview import:
   - prodotti importabili;
   - prodotti saltati;
   - errori;
   - esempi descrizione originale/pulita;
   - stima immagini;
   - regole prezzo applicate.
8. Conferma import.
9. Vede avanzamento job e risultati.

## Flusso 1.0 per catalogo Shopify esistente

Per la 1.0 custom privata, il tab Importazione deve supportare anche una
modalità generica **Collega catalogo esistente**. Serve quando lo store Shopify
ha già prodotti creati da una precedente app o da lavoro manuale e SyncBay deve
diventare l'unico gestore del flusso eBay -> Shopify.

Questo flusso non deve diventare una migrazione Numisleo-specifica. Le decisioni
store-specifiche vivono nel runbook; il prodotto espone capacità riusabili:

1. leggere prodotti Shopify esistenti e listing eBay;
2. proporre match forti e casi incerti;
3. mostrare dry-run e campi che verrebbero modificati;
4. separare righe applicabili, eccezioni da rivedere e blocchi critici;
5. applicare solo righe sicure dopo conferma;
6. salvare snapshot, audit e report per recovery manuale;
7. consegnare lo shop al sync ordinario SyncBay.

Regole chiave:

- match automatico solo con segnali forti, non da titolo simile da solo;
- eBay resta sorgente di verità quando il dato è presente e valido;
- dato eBay assente o non affidabile = eccezione da rivedere, non svuotamento
  Shopify;
- prezzo e disponibilità vengono riallineati a eBay quando validi;
- descrizioni pulite secondo la regola descrizione SyncBay;
- immagini corrette solo se mancanti, rotte o chiaramente incoerenti;
- URL prodotto preservati di default; cambio handle solo con redirect e riga
  esplicita nel report;
- collezioni automatiche esistenti preservate di default, aggiornando i campi
  prodotto che le alimentano;
- vecchia app disattivabile prima dell'apply finale solo dopo audit, dry-run,
  export segnali utili e freeze operativo.

## Release privata 1.0 prima dell'onboarding

La release `1.0.0` si chiude prima di qualunque installazione cliente. SyncBay
deve essere una custom app privata completa, verificata e installabile; non è
ancora una release Shopify App Store pubblica e non introduce billing pubblico.

Prima di avviare onboarding o dry-run su uno store reale devono essere verdi:

- Vercel production sul commit candidato;
- Supabase senza blocchi provider, inclusi `402 exceed_egress_quota`;
- informativa privacy e termini pubblici;
- runbook onboarding/import aggiornato;
- test, build, release locale, tag Git e GitHub Release;
- handoff operativo con URL production, versione installabile e blocchi
  residui pari a zero.

Il primo store cliente usa la `1.0.0` già rilasciata. Se durante quell'onboarding
emergono bug, la correzione esce come patch `1.0.1+`: non si sposta
retroattivamente il confine della 1.0.

Le azioni UI da seguire durante l'onboarding post-release sono:

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

## Mini kit clienti selezionati 1.0

Questo mini kit accompagna la 1.0 custom privata. Non è materiale App Store
pubblico: serve a dare a un cliente selezionato aspettative chiare prima di
installazione, takeover e verifica finale.

### Promessa prodotto

SyncBay porta un catalogo eBay.it in Shopify in modo controllato: preview prima
delle scritture, match conservativo, disponibilità protetta e conflitti visibili
quando Shopify non è più allineato all'ultimo valore scritto da SyncBay.

### Requisiti prima dell'installazione

- account eBay.it corretto e accessibile;
- accesso Shopify con permessi necessari a prodotti, inventario, media,
  pubblicazioni, webhook e ordini pagati;
- una location Shopify predefinita da usare per lo stock;
- catalogo entro il limite operativo 1.0 di 2.000 listing eBay attivi;
- assenza di varianti complesse nel perimetro operativo iniziale;
- decisione su stato prodotti, canali di pubblicazione, regola prezzo e regola
  descrizione;
- disponibilità a fermare modifiche manuali durante la finestra di freeze.

### Limiti 1.0

- marketplace supportato: eBay.it;
- distribuzione privata per uno o pochi clienti selezionati;
- niente App Store pubblico, billing pubblico o support policy pubblica;
- nessun exporter Shopify -> eBay, salvo aggiornamento disponibilità eBay da
  ordini Shopify pagati;
- nessun rollback self-service prodotto-per-prodotto: recovery manuale tramite
  snapshot, report e strumenti interni;
- cambio handle/URL non automatico: richiede riga esplicita e redirect.

### Checklist onboarding

1. Confermare store Shopify, account eBay e location Shopify.
2. Collegare eBay da SyncBay.
3. Impostare default import, pubblicazioni, prezzo, descrizioni e sync.
4. Eseguire audit read-only dello store e del catalogo eBay.
5. Aprire `Importazione -> Collega catalogo esistente`.
6. Generare preview live e leggere righe `applicabile`, `da_rivedere`,
   `bloccante` e `gia_collegato`.
7. Risolvere o accettare consapevolmente le eccezioni non critiche.
8. Confermare freeze e disattivazione della vecchia app solo quando il runbook
   lo consente.
9. Applicare solo righe sicure.
10. Verificare manualmente catalogo Shopify, listing eBay, job e conflitti.

### Durante il freeze

Durante il freeze non si modificano manualmente prodotti, prezzi, quantità,
immagini, descrizioni, tag, categorie o regole di pubblicazione su eBay o
Shopify. Non si importano nuovi prodotti con la vecchia app. Il freeze serve a
evitare che SyncBay applichi un piano calcolato su dati già cambiati.

### Controlli dopo apply

- mapping prodotto e ItemID eBay collegati;
- prezzo, disponibilità e SKU corretti;
- immagini Shopify preservate o integrate secondo policy;
- descrizioni pulite senza template commerciali pesanti;
- product type, categoria e faccette coerenti;
- URL prodotto preservati o redirect presenti quando approvati;
- collezioni automatiche ancora alimentate dai campi corretti;
- sync automatico eBay -> Shopify attivo al target concordato;
- job `orders/paid` -> eBay stock pronti e monitorati;
- conflitti critici assenti prima del go-live.

### Se SyncBay segnala eccezioni

Le eccezioni non vanno ignorate. Se riguardano mapping, prezzo o disponibilità,
bloccano il go-live finché non sono risolte. Se riguardano descrizioni, immagini,
categorie, faccette, SEO o tag, possono restare da rivedere solo se non
compromettono vendita, disponibilità e tracciabilità del prodotto.

### Link cliente

- Informativa privacy: `/privacy`.
- Termini SyncBay: `/terms`.

## Stato preparatorio implementato

La dashboard embedded mostra già una readiness operativa per:

- connessione Shopify, scope e webhook 1.0 privata;
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
- normalizza le descrizioni eBay rimuovendo template negozio, colori inline,
  script/stili e markup non essenziale prima di mostrarle e passarle
  all'import Shopify;
- mantiene la preview mock con dati fittizi solo quando eBay non è collegato o
  quando serve un fallback dimostrativo;
- mantiene ogni scrittura Shopify dietro conferma esplicita;
- crea o riusa prodotti Shopify in modo idempotente per eBay ItemID;
- registra mapping prodotto, snapshot e job audit per ogni prodotto gestito;
- mostra default import e sequenza di preview prevista;
- mostra conteggi dry-run, regole di validazione 1.0 e readiness delle fasi
  successive;
- mantiene il dry-run bloccato finché mancano account eBay collegato, location
  Shopify predefinita o lettura eBay valida.

Validazioni 1.0 già codificate per la preview:

- SKU mancante;
- prezzo assente o non valido;
- disponibilità assente o non leggibile;
- listing senza immagini;
- varianti troppo complesse per il perimetro 1.0;
- descrizione eBay ripulita da template, colori o markup non essenziale.

La base di import Shopify in `draft` è preparata dietro feature flag:

- env: `SYNCBAY_DRAFT_IMPORT_ENABLED=false` per default;
- env: `SYNCBAY_DRAFT_IMPORT_LIMIT` per limitare il batch operativo;
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
- la conferma import pianifica job `IMPORT_CATALOG` in batch basati su
  `SYNCBAY_DRAFT_IMPORT_LIMIT`, leggendo gli ItemID attivi da Trading API fino
  al minore tra listing disponibili nello store e limite operativo 1.0 di 2.000 prodotti;
- le Impostazioni embedded permettono di attivare o disattivare il sync
  catalogo automatico eBay -> Shopify dopo l'import; l'attivazione resta
  bloccata finché mancano account eBay collegato, location Shopify predefinita
  o prodotti importati;
- ogni prodotto creato o riusato aggiorna anche prezzo e SKU della variante
  Shopify, oltre a stato prodotto, immagini e inventario;
- SyncBay calcola una proposta categoria Shopify per numismatica, filatelia,
  modellini auto, dischi musicali, macchine da scrivere e cataloghi/libri
  cartacei, salvando categoria eBay marketplace/negozio, categoria Shopify
  candidata, `productType`, confidenza e motivo nello snapshot diagnostico;
  sui nuovi prodotti creati dall'import passa subito `category` e `productType`
  a Shopify quando la proposta è valida, senza creare tag categoria;
- `npm run categories:backfill -- --shop syncbay-dev.myshopify.com` confronta
  in sola lettura i prodotti collegati con la proposta categoria SyncBay e
  classifica applicabili, già corretti, conflitti manuali e incerti prima di
  qualsiasi apply; la scrittura reale richiede
  `--apply --confirm-apply` e aggiorna solo le righe applicabili, saltando
  conflitti e incertezze; un lookup Trading fallito non blocca una proposta
  locale già valida, ma resta segnalato quando impedisce di proporre una
  categoria affidabile;
- l'import reale ha completato 958 listing sul dev store con mapping, snapshot,
  job e audit coerenti. La schedule Supabase Cron `syncbay-run-due-jobs`
  riprende ogni 5 minuti i job `IMPORT_CATALOG` dovuti.

Copertura attuale della preview live:

- la prima lettura usa Inventory API eBay e considera inventory item con offer
  pubblicate;
- se non emergono prodotti importabili, SyncBay usa Trading API
  `GetMyeBaySelling` in sola lettura per coprire listing attivi storici creati o
  gestiti solo da Seller Hub/UI;
- per i primi 10 listing Trading della preview, SyncBay prova `GetItem` per
  recuperare dettagli e immagini non restituiti nella lista;
- la prima pagina di preview resta limitata a 50 prodotti, entro il limite
  tecnico massimo di 100 per lettura UI;
- l'import catalogo completo è pianificato in batch asincroni fino a 2.000
  listing attivi e si ferma prima se Trading API dichiara o restituisce meno
  listing per lo store collegato;
- la dashboard mostra l'avanzamento dell'ultima run import con conteggi per
  batch catalogo/import Shopify, job attivi, job falliti e problemi recenti;
- `npm run import:verify -- --shop syncbay-dev.myshopify.com --sample 10`
  confronta un campione dell'ultima run tra snapshot eBay/SyncBay, mapping e
  prodotti Shopify live.
- `npm run descriptions:cleanup-report -- --shop syncbay-dev.myshopify.com
  --sample 20` misura su listing eBay reali la pulizia descrizioni prima
  dell'import, riportando caratteri rimossi, segnali template e brevi estratti
  testuali.

Smoke UI locale:

- `npm run smoke:ui` verifica che dashboard, preview import e gestione location
  restino presenti nelle superfici React Router principali.

La preview import resta bloccata finché non sono disponibili:

- account eBay collegato via OAuth;
- location Shopify predefinita;
- lettura live eBay riuscita tramite Inventory API o Trading API, oppure
  fallback dimostrativo accettabile per la fase.

## Default consigliati

- Prodotti iniziali in `pubblicato`, pubblicati secondo la policy canali Shopify
  scelta in Impostazioni, con fallback opzionale `bozza`.
- Tutte le immagini copiate su Shopify.
- Nessuna cancellazione automatica delle immagini Shopify se eBay non restituisce
  immagini per un listing durante una lettura incompleta.
- Una sola location Shopify predefinita.
- Nessun matching automatico aggressivo con prodotti Shopify esistenti.
- Nessun publish massivo senza conferma.
- Per cataloghi Shopify esistenti, preservare gli URL prodotto e le regole delle
  collezioni automatiche, salvo correzioni approvate nel report.

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
