# SyncBay - Piano prodotto e tecnico

Data: 2026-05-09

## Obiettivo

SyncBay è una Shopify app, prima custom e poi pubblica su Shopify App Store, che consente a un negoziante di collegare il proprio negozio eBay.it a Shopify e creare un catalogo Shopify operativo e allineato.

La sorgente di verità del catalogo resta eBay. SyncBay importa e mantiene aggiornati prodotti, titoli, descrizioni, prezzi, quantità, immagini e attributi principali verso Shopify. Shopify può applicare regole commerciali proprie, come sconti, markup, arrotondamenti e pulizia del template descrizione, senza modificare eBay.

## Direzione confermata

- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: gli ordini Shopify devono aggiornare la disponibilità su eBay per ridurre il rischio di vendere prodotti non disponibili.
- Marketplace iniziale: eBay.it.
- Distribuzione corrente: custom app privata 1.0 per clienti selezionati.
- Obiettivo successivo: app pubblica Shopify App Store.
- Latenza target: finestra configurabile 5-30 minuti.
- Limite operativo 1.0: fino a 2.000 prodotti per shop.
- Listing da coprire: tutti i listing eBay attivi del negoziante, inclusi quelli storici/non creati da SyncBay.
- Prodotto chiuso o rimosso da eBay: prodotto Shopify mantenuto attivo come
  esaurito, non archiviato né cancellato, per preservarne la SEO (ADR 0011).
- Modifica manuale su Shopify: conflitto visibile in dashboard, non sovrascrittura silenziosa.

## Posizionamento competitivo

Benchmark di riferimento: `docs/market/shopify-ebay-app-benchmark.md`.

Le app Shopify App Store già pubblicate coprono soprattutto integrazione marketplace generalista, import/export bidirezionale, ordini, inventario, multi-account e supporto umano molto visibile. SyncBay deve differenziarsi con un perimetro più stretto e un prodotto self-service:

- eBay.it come punto di partenza;
- eBay come sorgente di verità;
- Shopify come copia pulita, vendibile e controllata;
- import con preview e rollback;
- descrizioni eBay ripulite dai template pesanti;
- conflitti Shopify visibili;
- diagnostica comprensibile e azioni guidate senza supporto umano;
- protezione delle disponibilità anche senza sync bidirezionale completo;
- promessa chiara: sync entro una finestra configurabile, con real-time dove tecnicamente possibile e sostenibile.

Formula prodotto:

> SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilità sincronizzate e meno rischio di vendere prodotti non disponibili.

Tagline principale:

> Dal tuo negozio eBay a Shopify, pronto a vendere.

Branding: vedi `BRAND.md`.

## Non obiettivo 1.0 privata

- Sync bidirezionale completo Shopify -> eBay.
- Export o creazione listing eBay da Shopify.
- Gestione avanzata ordini, spedizioni, tracking e fulfillment.
- Multi-marketplace eBay oltre eBay.it.
- Multi-account eBay per singolo shop.
- Varianti complesse complete, compatibilità auto/moto e item specifics avanzati.
- Mapping manuale sofisticato categorie/attributi.
- AI mapping come requisito di prima versione.

## Architettura proposta

```text
Merchant
  -> installa SyncBay su Shopify
  -> collega account eBay.it

eBay.it
  -> import iniziale listing
  -> notifiche/revisioni dove disponibili
  -> polling incrementale configurabile

SyncBay backend
  -> normalizza catalogo del negozio eBay
  -> applica regole Shopify-only
  -> gestisce code, retry, rate limit e conflitti
  -> conserva snapshot e mapping

Shopify Admin GraphQL
  -> crea/aggiorna prodotti
  -> crea/aggiorna immagini
  -> aggiorna inventario
  -> mantiene come esauriti i prodotti non più attivi su eBay

Dashboard SyncBay
  -> stato sync
  -> conflitti
  -> errori
  -> anteprime descrizione
  -> regole prezzo
```

## Stack iniziale

La decisione stack è tracciata in `docs/decisions/0001-stack.md`.

Direzione corrente:

- Shopify CLI;
- template ufficiale React Router al momento dello scaffold;
- TypeScript/Node;
- Shopify Admin GraphQL;
- Vercel per app embedded, backend HTTP, OAuth e webhook;
- Supabase Postgres;
- Prisma;
- Supabase Queues;
- Supabase Cron;
- Supabase Storage come staging privato temporaneo per immagini quando serve.

La decisione infrastrutturale runtime è tracciata in `docs/decisions/0005-runtime-infrastructure.md`.

Nota: lo scaffold Shopify CLI React Router è stato creato dopo la chiusura delle
decisioni tecniche bloccanti. Import, OAuth eBay, runner HTTP, Supabase
Cron/Queues, sync incrementale e aggiornamento stock eBay da ordini Shopify
sono ora superfici implementate nel perimetro 1.0 privata; nuovi runtime o consumer
dedicati restano decisioni separate.

## API e integrazioni

### Shopify

Usare Shopify Admin GraphQL come interfaccia principale. La mutazione `productSet` è indicata per sincronizzare prodotti da sorgenti esterne e gestire aggiornamenti batch di catalogo.

Scope iniziali previsti:

- `read_products`
- `write_products`
- `read_inventory`
- `write_inventory`
- `read_locations`
- `write_locations`
- `read_publications`
- `write_publications`
- `read_orders` per il webhook `orders/paid`, da attivare solo dopo
  approvazione Shopify protected customer data per la protezione disponibilità.
- `write_orders` per la prova automatica controllata del trigger ordine pagato
  via Admin `orderCreate` sul dev store, da mantenere solo se resta necessario
  ai gate operativi della distribuzione privata.
- `read_files` e `write_files` per media prodotto.
- token offline Shopify a scadenza con refresh automatico per i job automatici,
  in linea con ADR `0009-shopify-token-offline-a-scadenza.md` e con il
  requisito Shopify public app dal 1 gennaio 2027.

Webhook Shopify 1.0:

- app uninstall, per cleanup e revoca token.
- inventory level update come trigger iniziale non-customer-data per aggiornare disponibilità eBay.
- order paid o order created come trigger futuro, dopo configurazione Shopify protected customer data.
- product update, per rilevare modifiche manuali e aprire conflitti.

### eBay

Usare una combinazione di:

- Trading API per leggere tutti i listing attivi, inclusi listing storici creati da Seller Hub/UI eBay.
- GetMyeBaySelling/GetItem/GetSellerEvents per import, dettaglio, immagini e polling incrementale.
- Platform Notifications, dove disponibili, per accelerare revisioni tipo `ItemRevised`.
- Inventory API dove disponibile per aggiornare quantità/prezzi di listing compatibili e per casi già migrati al modello inventory.

Scope e requisiti eBay da prevedere:

- OAuth venditore.
- lettura listing e dettagli prodotto.
- aggiornamento disponibilità su eBay per ridurre il rischio di vendere prodotti non disponibili.
- endpoint pubblico HTTPS per notifiche.
- gestione obbligatoria notifiche eBay di marketplace account deletion o opt-out se applicabile.

## Modello dati

Entità principali:

- `shops`: shop Shopify, stato installazione, piano, preferenze.
- `shopify_credentials`: token cifrati e scope concessi.
- `ebay_accounts`: account eBay collegato, marketplace, token cifrati.
- `sync_mappings`: mapping eBay item ID / SKU / Shopify product ID / Shopify variant ID.
- `product_snapshots`: ultimo valore letto da eBay e ultimo valore scritto su Shopify.
- `pricing_rules`: sconti, markup, arrotondamenti, prezzo minimo, compare-at price.
- `description_rules`: modalità HTML completo, testo pulito, template rimosso.
- `media_assets`: immagini importate, hash/deduplica, stato upload Shopify.
- `sync_jobs`: job import/sync, stato, retry, errori.
- `conflicts`: campo, valore eBay, valore Shopify, decisione del negoziante.
- `audit_logs`: eventi sync, errori API, modifiche regole, messe in esaurito e
  archiviazioni operative.

## Import catalogo

Flusso iniziale:

1. Connessione Shopify.
2. Connessione eBay.it via OAuth.
3. Scelta location Shopify predefinita.
4. Scelta stato import iniziale: `draft` o pubblicato.
5. Scelta canali Shopify per i prodotti pubblicati: tutti, selezionati o nessuno.
6. Scelta modalità descrizione.
7. Lettura listing attivi eBay in pagine.
8. Recupero dettagli completi per listing.
9. Normalizzazione dati in modello interno.
10. Preview import con conteggi, errori e campioni prodotto.
11. Import in stato `draft` o pubblicato, secondo impostazione del negoziante.
12. Upload immagini su Shopify con deduplica.
13. Creazione mapping stabile e snapshot.
14. Avvio sync periodico.

Default consigliato:

- import iniziale in `pubblicato`, con possibilità di usare `draft` da Impostazioni;
- pubblicazione su tutti i canali Shopify disponibili, configurabile a soli
  canali selezionati o nessuna pubblicazione automatica;
- publish massivo solo dopo preview;
- copia fisica delle immagini su Shopify, non dipendenza permanente dagli URL eBay;
- location Shopify predefinita selezionata durante onboarding.

## Sync a finestra configurabile

La promessa 1.0 è una finestra target configurabile, non "real-time assoluto" indiscriminato.

Dove il real-time o quasi real-time è tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilità, SyncBay deve preferirlo. Il polling configurato resta la rete di sicurezza per eventi non coperti o notifiche perse.

Strategia:

- notifiche eBay dove disponibili per accelerare revisioni;
- polling incrementale secondo target configurato;
- coda job prioritaria per inventario;
- scheduler Supabase Cron per creare/drenare job a batch;
- idempotenza su ogni job;
- retry con backoff;
- resume automatico se import o sync si interrompe;
- riconciliazione periodica completa per correggere drift.

Priorità job:

1. Aggiornamento stock dopo ordine Shopify.
2. Aggiornamento quantità/prezzo eBay -> Shopify.
3. Aggiornamento titolo/descrizione/immagini.
4. Archiviazione prodotti chiusi.
5. Riconciliazione completa.

## Protezione disponibilità

Anche se il sync catalogo è one-way, SyncBay deve proteggere la disponibilità eBay quando Shopify vende.

Default:

- trigger principale: ordine Shopify pagato.
- opzione aggressiva: ordine creato, utile per negozianti con alto rischio di vendere prodotti non disponibili.
- aggiornamento eBay tramite API compatibile con il tipo di listing.
- se update eBay fallisce, creare alert critico in dashboard e retry prioritario.
- stock buffer configurabile, per mantenere una riserva non pubblicata su Shopify.
- soglia di sicurezza: se eBay non risponde o il sync stock è incerto, SyncBay può mettere il prodotto Shopify in stato prudente secondo configurazione.

Regola: la quantità disponibile da mostrare su Shopify deve rispettare lo stato eBay più recente noto, salvo conflitti espliciti.

## Regole prezzo Shopify-only

Le regole non modificano eBay. Si applicano solo al prezzo scritto su Shopify.

Tipi:

- sconto percentuale globale 1.0, già persistito per shop come intero `0-90`;
- sconto fisso;
- markup percentuale;
- markup fisso;
- moltiplicatore;
- arrotondamento a due decimali o all'euro per il caso globale 1.0;
- prezzo minimo;
- margine minimo se il negoziante fornisce un costo;
- compare-at price Shopify valorizzato con il prezzo eBay originale quando lo
  sconto globale è attivo;
- regole globali 1.0, regole per categoria in fase successiva.

Ogni sync deve conservare:

- prezzo originale eBay;
- prezzo calcolato Shopify;
- regola applicata;
- timestamp ultimo calcolo.

Quando la regola globale cambia dalle Impostazioni, SyncBay pianifica batch di
sync incrementale per riallineare anche i prodotti già importati.

## Descrizioni e template eBay

Modalità supportate:

- HTML completo eBay.
- Solo testo.
- HTML pulito con rimozione template.

La rimozione template deve essere configurabile con anteprima prima dell'applicazione massiva. Il negoziante deve poter vedere almeno:

- descrizione originale;
- descrizione pulita;
- differenze principali;
- numero di prodotti coinvolti.

## Immagini e media

Default 1.0: importare tutte le immagini dei listing eBay e copiarle su Shopify.

Requisiti:

- deduplica immagini;
- retry upload;
- limite e fallback se Shopify o eBay rifiutano asset;
- conservazione relazione immagine -> prodotto/variante;
- log errori per immagini mancanti o non scaricabili.

Opzioni future:

- solo prima immagine;
- massimo N immagini;
- non importare immagini;
- aggiornamento immagini solo manuale.

## Varianti e attributi

1.0 privata:

- prodotti singoli;
- varianti semplici quando i dati eBay sono chiari e mappabili;
- fallback esplicito per varianti non mappabili: prodotto saltato o import parziale solo se il negoziante lo approva;
- log dei listing esclusi per varianti complesse;
- cinque faccette storefront controllate come metafield prodotto Shopify:
  `Categoria`, `Area / Stato`, `Materiale`, `Conservazione`, `Perizia`.

Decisione attuale: ADR 0016. Le faccette vengono lette da categoria negozio
eBay, categoria marketplace, `ItemSpecifics` Trading API e, quando i campi
strutturati sono insufficienti, da un parser titolo conservativo con lista chiusa
di segnali numismatici. I valori vengono scritti nel namespace
`syncbay_facets` e salvati nel payload diagnostico. SyncBay non crea tag filtro e
non deduce valori mancanti da descrizione HTML o assenza del campo.

Post-1.0:

- varianti complesse;
- immagini per variante;
- compatibilità auto/moto;
- attributi categoria avanzati;
- mapping assistito.

## Mapping categorie

Scelta 1.0: automatico e prudente.

Strategia:

- mappare categorie eBay a proposta di categoria Shopify standard,
  `productType` e metafield SyncBay/eBay;
- non creare tag categoria;
- non bloccare import se la categoria non è mappabile;
- registrare confidenza e fallback;
- lasciare il prodotto importabile anche con mapping categoria incompleto;
- salvare in dry-run/report la proposta categoria anche quando non viene
  applicata.

Decisione attuale: ADR 0015. L'import di nuovi prodotti passa `category` e
`productType` a Shopify quando la proposta SyncBay ha una categoria valida e
confidenza non bassa; i casi incerti restano importabili senza categoria
Shopify. L'apply sui prodotti già collegati deve partire da report/preview e
non sovrascrivere categorie Shopify manuali senza conferma esplicita. La mappa
iniziale copre le categorie osservate nel catalogo di riferimento: numismatica,
filatelia, modellini auto, dischi musicali, macchine da scrivere e
cataloghi/libri cartacei. Il comando operativo
`npm run categories:backfill -- --apply --confirm-apply` applica solo righe
`applicable` e salta conflitti manuali, incertezze, lookup falliti senza
proposta locale valida e prodotti senza GID Shopify. I conflitti generati da
vecchie regole del mapper possono essere inclusi solo con flag di repair
espliciti e pattern riconosciuti, senza trasformare il backfill in una
sovrascrittura massiva delle categorie manuali.

Le cinque faccette storefront `syncbay_facets.*` seguono lo stesso principio:
il comando operativo `npm run facets:backfill` è dry-run di default, confronta i
metafield Shopify attuali con la proposta SyncBay derivata da snapshot eBay,
titolo e Trading API `GetItem` con `ItemSpecifics`, e classifica righe
applicabili, già corrette, conflitti manuali e incerte. La scrittura reale
richiede `--apply --confirm-apply`, usa Shopify Admin GraphQL `metafieldsSet`,
aggiunge solo metafield mancanti e non attiva filtri storefront Search &
Discovery.

## Matching prodotti esistenti

1.0 privata:

- import crea nuovi prodotti Shopify con mapping stabile;
- modalità `Collega catalogo esistente` per riusare prodotti Shopify già
  presenti con matching conservativo e conferma prima delle scritture;
- non tentare matching automatico aggressivo se il negoziante ha già prodotti Shopify;
- l'anteprima mostra suggerimenti conservativi basati su SKU, item id, metafield,
  handle o titolo, senza collegamento automatico sui match deboli.

Evoluzione post-1.0:

- matching più ricco su varianti complesse;
- strumenti di revisione bulk per cataloghi sopra il limite operativo 1.0.

## Conflitti Shopify

Un conflitto nasce quando Shopify viene modificato manualmente dopo che SyncBay aveva scritto un valore controllato.

Campi monitorati 1.0:

- titolo;
- descrizione;
- prezzo;
- quantità;
- immagini;
- stato prodotto.

Dashboard conflitti:

- mostra prodotto, campo, valore eBay, valore Shopify, ultimo valore scritto da SyncBay;
- azioni: "mantieni Shopify", "riallinea da eBay", "ignora questo campo";
- nessuna sovrascrittura silenziosa per campi in conflitto.

## Modalità mirror controllato

SyncBay non deve essere un sync cieco. Ogni campo sincronizzato deve avere una regola di controllo esplicita:

- controllato da eBay;
- controllato da Shopify;
- calcolato da SyncBay;
- ignorato dal sync.

Questo permette al negoziante di mantenere Shopify come copia pulita di eBay senza perdere controllo su campi specifici come descrizione, immagini, SEO o prezzo Shopify-only.

## Dashboard operativa

La dashboard 1.0 deve essere il centro operativo del sync, non solo una pagina informativa.

Deve mostrare:

- stato connessioni Shopify/eBay;
- ultimo sync;
- prossimo sync;
- prodotti sincronizzati;
- prodotti falliti;
- conflitti aperti;
- job in corso;
- alert disponibilità critica;
- log errori filtrabili;
- retry manuale per job falliti.
- centro salute catalogo con cause concrete;
- stato riconciliazione completa programmata.

## Diagnostica self-service

Poiché SyncBay non deve dipendere da supporto umano nella prima fase, ogni errore rilevante deve essere leggibile e azionabile dal negoziante.

Esempi di errori:

- SKU mancante;
- immagine non scaricabile;
- variante troppo complessa;
- listing eBay non leggibile;
- eBay rate limit;
- token eBay scaduto;
- disponibilità eBay non aggiornata;
- prodotto Shopify modificato manualmente.

Ogni errore deve mostrare:

- cosa è successo;
- impatto sul prodotto o sullo stock;
- prossima azione consigliata;
- pulsante di retry quando sicuro;
- riferimento tecnico interno per audit/log.
- dettagli rate-limit provider quando il retry è bloccato da cooldown.

## Archiviazione prodotti

Se un listing eBay risulta chiuso, rimosso o non più attivo:

- il prodotto Shopify resta pubblicato/servito come esaurito, non archiviato;
- la scorta viene portata a `0` con politica `DENY`;
- viene applicato un marcatore operativo `esaurito`;
- il mapping passa a `OUT_OF_STOCK`;
- conservare mapping e snapshot;
- loggare motivo e timestamp;
- non cancellare prodotto né immagini in automatico.

Questa sezione segue ADR 0011: il nome storico di alcuni job può ancora
contenere `ARCHIVE_INACTIVE_LISTING`, ma il comportamento atteso è messa in
esaurito per preservare la SEO.

## Privacy, compliance e sicurezza

Obbligatorio dalla 1.0 privata:

- cifratura token Shopify ed eBay a riposo;
- rotazione/refresh token eBay;
- gestione disinstallazione Shopify;
- GDPR webhooks Shopify dove richiesti;
- cancellazione o anonimizzazione dati shop su richiesta;
- gestione eBay marketplace account deletion notifications o opt-out corretto se non applicabile;
- audit log accessi e modifiche critiche;
- separazione dati per shop/tenant.

## Rate limit, code e resilienza

Il sistema deve gestire 2.000 prodotti senza dipendere da richieste sincrone lunghe.

Requisiti:

- job queue persistente;
- import asincrono;
- retry con backoff;
- rate limit per provider;
- idempotency key per job prodotto;
- lock per evitare sync concorrenti sullo stesso prodotto;
- resume import dopo errore;
- pagina stato con progresso e prodotti falliti;
- riconciliazione completa programmata.

## Rollback e anti-disastro

Prima import: preview/dry-run obbligatorio.

Azioni rollback 1.0:

- archiviare tutti i prodotti creati da SyncBay in una sessione import;
- ripristinare ultimo snapshot scritto da SyncBay per prodotti aggiornati;
- disattivare sync automatico per shop;
- mettere in pausa aggiornamento stock e mostrare warning critico;
- esportare log errori per supporto.

## Fasi

### Fase 0 - Repo e fondazioni

- Inizializzare repo.
- Definire stack.
- Definire schema database.
- Creare app Shopify custom.
- Creare app eBay developer sandbox/production.
- Documentare env vars e runbook locale.

### Fase 1 - Connessioni

- Installazione Shopify custom.
- Connessione eBay OAuth.
- Salvataggio token cifrati.
- Dashboard minima con stato connessioni.

### Fase 2 - Import iniziale

- Lettura listing eBay.it.
- Import fino a 2.000 prodotti.
- Mapping Shopify product/variant.
- Upload immagini.
- Preview/dry-run.
- Import default draft.
- Onboarding guidato con scelta location, stato prodotto, immagini e modalità descrizione.

### Fase 3 - Sync catalogo

- Polling incrementale secondo target configurato.
- Aggiornamento prezzo, quantità, titolo, descrizione, immagini.
- Archiviazione prodotti non più attivi.
- Audit log e retry.
- Dashboard stato sync, job falliti, conflitti e alert.

### Fase 4 - Protezione disponibilità

- Webhook ordine Shopify.
- Aggiornamento disponibilità eBay prioritario.
- Alert e retry critici.
- Test scenario vendite concorrenti.
- Stock buffer e modalità prudente.

### Fase 5 - Regole e conflitti

- Regole prezzo avanzate.
- Pulizia descrizione con anteprima.
- Conflitti Shopify dashboard.
- Azioni risoluzione conflitti.

### Fase 6 - Custom app privata 1.0

- Clienti selezionati.
- Test 2.000 prodotti.
- Monitoraggio errori.
- Hardening rate limit.
- Diagnostica self-service e runbook interno.

### Fase 7 - Preparazione app pubblica

- Shopify App Store requirements.
- Billing.
- Privacy policy.
- Onboarding self-service.
- Review security/compliance.
- Documentazione self-service.

## Livelli prodotto futuri

- Private 1.0: fino a 2.000 prodotti, eBay.it, 1 account eBay, 1 location Shopify.
- Growth: fino a 10.000 prodotti, multi-location, matching avanzato e varianti migliorate.
- Public: billing, onboarding self-service, diagnostica avanzata, multi-marketplace opzionale.

Feature future da valutare:

- checklist qualità import/listing più ricca, senza punteggi opachi e solo se
  utile a spiegare rischi concreti senza appesantire il flusso del negoziante.
- comunicazione sconti/prezzi storefront pre-carrello, solo dopo valutazione
  dedicata di scope Shopify, App Store, theme app extension, coerenza tra prezzo
  reale Shopify, compare-at price, sconti carrello/checkout e messaggi
  promozionali.

## Verifiche di accettazione

- Import 10 prodotti eBay.it di test con immagini.
- Import 2.000 prodotti con resume dopo errore simulato.
- Prezzo modificato su eBay aggiornato su Shopify entro la finestra target configurata.
- Quantità modificata su eBay aggiornata su Shopify entro la finestra target configurata.
- Ordine Shopify pagato riduce disponibilità eBay o genera alert critico con retry.
- Modifica manuale Shopify apre conflitto.
- Listing eBay chiuso mantiene il prodotto Shopify in vetrina come esaurito.
- Regole sconto/markup/arrotondamento applicate senza modificare eBay.
- Descrizione pulita visibile in anteprima prima di applicazione massiva.
- Disinstallazione app revoca accesso e ferma sync.

## Rischi principali

- Alcuni listing eBay storici potrebbero richiedere Trading API e non Inventory API.
- Le notifiche eBay potrebbero non coprire tutti gli eventi necessari: il polling configurato resta obbligatorio.
- Aggiornare la disponibilità eBay da ordini Shopify è il punto più critico per ridurre vendite di prodotti non disponibili e rispettare i rate limit.
- Le descrizioni eBay possono contenere HTML pesante o template difficili da pulire senza falsi positivi.
- Le varianti complesse possono aumentare molto la complessità: vanno isolate dal perimetro 1.0 base.

## Fonti tecniche iniziali

- Shopify App Store reference: https://apps.shopify.com/epi
- Shopify productSet: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
- Shopify webhooks: https://shopify.dev/docs/apps/webhooks
- eBay GetMyeBaySelling: https://developer.ebay.com/Devzone/xml/docs/Reference/ebay/GetMyeBaySelling.html
- eBay GetItem: https://developer.ebay.com/Devzone/XML/docs/Reference/ebay/GetItem.html
- eBay Inventory API: https://developer.ebay.com/api-docs/sell/inventory/overview.html
- eBay ItemRevised: https://developer.ebay.com/api-docs/static/pn_item-revised.html
