# SyncBay - Piano prodotto e tecnico

Data: 2026-05-09

## Obiettivo

SyncBay e una Shopify app, prima custom e poi pubblica su Shopify App Store, che consente a un negoziante di collegare il proprio negozio eBay.it a Shopify e creare un catalogo Shopify operativo e allineato.

La sorgente di verita del catalogo resta eBay. SyncBay importa e mantiene aggiornati prodotti, titoli, descrizioni, prezzi, quantita, immagini e attributi principali verso Shopify. Shopify puo applicare regole commerciali proprie, come sconti, markup, arrotondamenti e pulizia del template descrizione, senza modificare eBay.

## Direzione confermata

- Sync principale: eBay -> Shopify.
- Eccezione obbligatoria: gli ordini Shopify devono aggiornare la disponibilita su eBay per ridurre il rischio di vendere prodotti non disponibili.
- Marketplace iniziale: eBay.it.
- Prima distribuzione: custom app per pilota controllato.
- Obiettivo successivo: app pubblica Shopify App Store.
- Latenza target: sync entro massimo 5 minuti.
- Scala MVP: fino a 2.000 prodotti per shop.
- Listing da coprire: tutti i listing eBay attivi del negoziante, inclusi quelli storici/non creati da SyncBay.
- Prodotto chiuso o rimosso da eBay: prodotto Shopify archiviato, non cancellato.
- Modifica manuale su Shopify: conflitto visibile in dashboard, non sovrascrittura silenziosa.

## Posizionamento competitivo

Benchmark di riferimento: `docs/market/shopify-ebay-app-benchmark.md`.

Le app Shopify App Store gia pubblicate coprono soprattutto integrazione marketplace generalista, import/export bidirezionale, ordini, inventario, multi-account e supporto umano molto visibile. SyncBay deve differenziarsi con un perimetro piu stretto e un prodotto self-service:

- eBay.it come punto di partenza;
- eBay come sorgente di verita;
- Shopify come copia pulita, vendibile e controllata;
- import con preview e rollback;
- descrizioni eBay ripulite dai template pesanti;
- conflitti Shopify visibili;
- diagnostica comprensibile e azioni guidate senza supporto umano;
- protezione delle disponibilita anche senza sync bidirezionale completo;
- promessa chiara: sync entro 5 minuti, con real-time dove tecnicamente possibile e sostenibile.

Formula prodotto:

> SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilita sincronizzate e meno rischio di vendere prodotti non disponibili.

Tagline principale:

> Dal tuo negozio eBay a Shopify, pronto a vendere.

Branding: vedi `BRAND.md`.

## Non obiettivo MVP

- Sync bidirezionale completo Shopify -> eBay.
- Export o creazione listing eBay da Shopify.
- Gestione avanzata ordini, spedizioni, tracking e fulfillment.
- Multi-marketplace eBay oltre eBay.it.
- Multi-account eBay per singolo shop.
- Varianti complesse complete, compatibilita auto/moto e item specifics avanzati.
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
  -> polling incrementale <= 5 minuti

SyncBay backend
  -> normalizza catalogo del negozio eBay
  -> applica regole Shopify-only
  -> gestisce code, retry, rate limit e conflitti
  -> conserva snapshot e mapping

Shopify Admin GraphQL
  -> crea/aggiorna prodotti
  -> crea/aggiorna immagini
  -> aggiorna inventario
  -> archivia prodotti non piu attivi su eBay

Dashboard SyncBay
  -> stato sync
  -> conflitti
  -> errori
  -> anteprime descrizione
  -> regole prezzo
```

## Stack iniziale

La decisione stack e tracciata in `docs/decisions/0001-stack.md`.

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

La decisione infrastrutturale MVP e tracciata in `docs/decisions/0005-runtime-infrastructure.md`.

Nota: lo scaffold Shopify CLI React Router e stato creato dopo la chiusura delle decisioni tecniche bloccanti. Import, sync, worker e OAuth eBay restano fuori dallo scaffold iniziale.

## API e integrazioni

### Shopify

Usare Shopify Admin GraphQL come interfaccia principale. La mutazione `productSet` e indicata per sincronizzare prodotti da sorgenti esterne e gestire aggiornamenti batch di catalogo.

Scope iniziali previsti:

- `read_products`
- `write_products`
- `read_inventory`
- `write_inventory`
- `read_locations`
- `read_orders` solo quando sara completata la configurazione Shopify per protected customer data.
- scope necessari per file/media e webhook, da confermare in fase scaffold in base alla versione API Shopify usata.

Webhook Shopify MVP:

- app uninstall, per cleanup e revoca token.
- inventory level update come trigger iniziale non-customer-data per aggiornare disponibilita eBay.
- order paid o order created come trigger futuro, dopo configurazione Shopify protected customer data.
- product update, per rilevare modifiche manuali e aprire conflitti.

### eBay

Usare una combinazione di:

- Trading API per leggere tutti i listing attivi, inclusi listing storici creati da Seller Hub/UI eBay.
- GetSellerList/GetItem/GetSellerEvents per import, dettaglio e polling incrementale.
- Platform Notifications, dove disponibili, per accelerare revisioni tipo `ItemRevised`.
- Inventory API dove disponibile per aggiornare quantita/prezzi di listing compatibili e per casi gia migrati al modello inventory.

Scope e requisiti eBay da prevedere:

- OAuth venditore.
- lettura listing e dettagli prodotto.
- aggiornamento disponibilita su eBay per ridurre il rischio di vendere prodotti non disponibili.
- endpoint pubblico HTTPS per notifiche.
- gestione obbligatoria notifiche eBay di marketplace account deletion o opt-out se applicabile.

## Modello dati

Entita principali:

- `shops`: shop Shopify, stato installazione, piano, preferenze.
- `shopify_credentials`: token cifrati e scope concessi.
- `ebay_accounts`: account eBay collegato, marketplace, token cifrati.
- `sync_mappings`: mapping eBay item ID / SKU / Shopify product ID / Shopify variant ID.
- `product_snapshots`: ultimo valore letto da eBay e ultimo valore scritto su Shopify.
- `pricing_rules`: sconti, markup, arrotondamenti, prezzo minimo, compare-at price.
- `description_rules`: modalita HTML completo, testo pulito, template rimosso.
- `media_assets`: immagini importate, hash/deduplica, stato upload Shopify.
- `sync_jobs`: job import/sync, stato, retry, errori.
- `conflicts`: campo, valore eBay, valore Shopify, decisione del negoziante.
- `audit_logs`: eventi sync, errori API, modifiche regole, archiviazioni.

## Import catalogo

Flusso iniziale:

1. Connessione Shopify.
2. Connessione eBay.it via OAuth.
3. Scelta location Shopify predefinita.
4. Scelta stato import iniziale: `draft` o pubblicato.
5. Scelta modalita descrizione.
6. Lettura listing attivi eBay in pagine.
7. Recupero dettagli completi per listing.
8. Normalizzazione dati in modello interno.
9. Preview import con conteggi, errori e campioni prodotto.
10. Import in stato `draft` o pubblicato, secondo impostazione del negoziante.
11. Upload immagini su Shopify con deduplica.
12. Creazione mapping stabile e snapshot.
13. Avvio sync periodico.

Default consigliato:

- import iniziale in `draft`;
- publish massivo solo dopo preview;
- copia fisica delle immagini su Shopify, non dipendenza permanente dagli URL eBay;
- location Shopify predefinita selezionata durante onboarding.

## Sync entro 5 minuti

La promessa MVP deve essere "sync entro 5 minuti", non "real-time assoluto" indiscriminato.

Dove il real-time o quasi real-time e tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilita, SyncBay deve preferirlo. Il polling entro 5 minuti resta la rete di sicurezza obbligatoria per eventi non coperti o notifiche perse.

Strategia:

- notifiche eBay dove disponibili per accelerare revisioni;
- polling incrementale ogni massimo 5 minuti;
- coda job prioritaria per inventario;
- scheduler Supabase Cron per creare/drenare job a batch;
- idempotenza su ogni job;
- retry con backoff;
- resume automatico se import o sync si interrompe;
- riconciliazione periodica completa per correggere drift.

Priorita job:

1. Aggiornamento stock dopo ordine Shopify.
2. Aggiornamento quantita/prezzo eBay -> Shopify.
3. Aggiornamento titolo/descrizione/immagini.
4. Archiviazione prodotti chiusi.
5. Riconciliazione completa.

## Protezione disponibilita

Anche se il sync catalogo e one-way, SyncBay deve proteggere la disponibilita eBay quando Shopify vende.

Default:

- trigger principale: ordine Shopify pagato.
- opzione aggressiva: ordine creato, utile per negozianti con alto rischio di vendere prodotti non disponibili.
- aggiornamento eBay tramite API compatibile con il tipo di listing.
- se update eBay fallisce, creare alert critico in dashboard e retry prioritario.
- stock buffer configurabile, per mantenere una riserva non pubblicata su Shopify.
- soglia di sicurezza: se eBay non risponde o il sync stock e incerto, SyncBay puo mettere il prodotto Shopify in stato prudente secondo configurazione.

Regola: la quantita disponibile da mostrare su Shopify deve rispettare lo stato eBay piu recente noto, salvo conflitti espliciti.

## Regole prezzo Shopify-only

Le regole non modificano eBay. Si applicano solo al prezzo scritto su Shopify.

Tipi:

- sconto percentuale;
- sconto fisso;
- markup percentuale;
- markup fisso;
- moltiplicatore;
- arrotondamento;
- prezzo minimo;
- margine minimo se il negoziante fornisce un costo;
- compare-at price;
- regole globali MVP, regole per categoria in fase successiva.

Ogni sync deve conservare:

- prezzo originale eBay;
- prezzo calcolato Shopify;
- regola applicata;
- timestamp ultimo calcolo.

## Descrizioni e template eBay

Modalita supportate:

- HTML completo eBay.
- Solo testo.
- HTML pulito con rimozione template.

La rimozione template deve essere configurabile con anteprima prima dell'applicazione massiva. Il negoziante deve poter vedere almeno:

- descrizione originale;
- descrizione pulita;
- differenze principali;
- numero di prodotti coinvolti.

## Immagini e media

Default MVP: importare tutte le immagini dei listing eBay e copiarle su Shopify.

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

MVP:

- prodotti singoli;
- varianti semplici quando i dati eBay sono chiari e mappabili;
- fallback esplicito per varianti non mappabili: prodotto saltato o import parziale solo se il negoziante lo approva;
- log dei listing esclusi per varianti complesse;
- item specifics base come metafield/tag Shopify.

Post-MVP:

- varianti complesse;
- immagini per variante;
- compatibilita auto/moto;
- attributi categoria avanzati;
- mapping assistito.

## Mapping categorie

Scelta MVP: automatico.

Strategia:

- mappare categorie eBay a product type, tag e metafield Shopify;
- non bloccare import se la categoria non e mappabile;
- registrare confidenza e fallback;
- lasciare il prodotto importabile anche con mapping categoria incompleto.

## Matching prodotti esistenti

MVP:

- import crea nuovi prodotti Shopify con mapping stabile;
- non tentare matching automatico aggressivo se il negoziante ha gia prodotti Shopify.

Roadmap prioritaria:

- wizard per collegare prodotti Shopify esistenti ai listing eBay;
- suggerimenti di match per SKU, titolo e barcode;
- conferma manuale prima di attivare sync su prodotti gia esistenti.

## Conflitti Shopify

Un conflitto nasce quando Shopify viene modificato manualmente dopo che SyncBay aveva scritto un valore controllato.

Campi monitorati MVP:

- titolo;
- descrizione;
- prezzo;
- quantita;
- immagini;
- stato prodotto.

Dashboard conflitti:

- mostra prodotto, campo, valore eBay, valore Shopify, ultimo valore scritto da SyncBay;
- azioni: "mantieni Shopify", "riallinea da eBay", "ignora questo campo";
- nessuna sovrascrittura silenziosa per campi in conflitto.

## Modalita mirror controllato

SyncBay non deve essere un sync cieco. Ogni campo sincronizzato deve avere una regola di controllo esplicita:

- controllato da eBay;
- controllato da Shopify;
- calcolato da SyncBay;
- ignorato dal sync.

Questo permette al negoziante di mantenere Shopify come copia pulita di eBay senza perdere controllo su campi specifici come descrizione, immagini, SEO o prezzo Shopify-only.

## Dashboard operativa

La dashboard MVP deve essere il centro operativo del sync, non solo una pagina informativa.

Deve mostrare:

- stato connessioni Shopify/eBay;
- ultimo sync;
- prossimo sync;
- prodotti sincronizzati;
- prodotti falliti;
- conflitti aperti;
- job in corso;
- alert disponibilita critica;
- log errori filtrabili;
- retry manuale per job falliti.

## Diagnostica self-service

Poiche SyncBay non deve dipendere da supporto umano nella prima fase, ogni errore rilevante deve essere leggibile e azionabile dal negoziante.

Esempi di errori:

- SKU mancante;
- immagine non scaricabile;
- variante troppo complessa;
- listing eBay non leggibile;
- eBay rate limit;
- token eBay scaduto;
- disponibilita eBay non aggiornata;
- prodotto Shopify modificato manualmente.

Ogni errore deve mostrare:

- cosa e successo;
- impatto sul prodotto o sullo stock;
- prossima azione consigliata;
- pulsante di retry quando sicuro;
- riferimento tecnico interno per audit/log.

## Archiviazione prodotti

Se un listing eBay risulta chiuso, rimosso o non piu attivo:

- Shopify product status -> archived;
- conservare mapping e snapshot;
- loggare motivo e timestamp;
- non cancellare prodotto ne immagini in automatico.

## Privacy, compliance e sicurezza

Obbligatorio dal primo MVP:

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

Azioni rollback MVP:

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
- Onboarding guidato con scelta location, stato prodotto, immagini e modalita descrizione.

### Fase 3 - Sync catalogo

- Polling incrementale <= 5 minuti.
- Aggiornamento prezzo, quantita, titolo, descrizione, immagini.
- Archiviazione prodotti non piu attivi.
- Audit log e retry.
- Dashboard stato sync, job falliti, conflitti e alert.

### Fase 4 - Protezione disponibilita

- Webhook ordine Shopify.
- Aggiornamento disponibilita eBay prioritario.
- Alert e retry critici.
- Test scenario vendite concorrenti.
- Stock buffer e modalita prudente.

### Fase 5 - Regole e conflitti

- Regole prezzo avanzate.
- Pulizia descrizione con anteprima.
- Conflitti Shopify dashboard.
- Azioni risoluzione conflitti.

### Fase 6 - Beta custom

- Merchant pilota.
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

- Pilot: fino a 2.000 prodotti, eBay.it, 1 account eBay, 1 location Shopify.
- Growth: fino a 10.000 prodotti, multi-location, matching prodotti esistenti, varianti migliorate.
- Public: billing, onboarding self-service, diagnostica avanzata, multi-marketplace opzionale.

Feature future da valutare:

- quality score import/listing, solo se utile a spiegare rischi concreti senza appesantire il flusso del negoziante.

## Verifiche di accettazione

- Import 10 prodotti eBay.it di test con immagini.
- Import 2.000 prodotti con resume dopo errore simulato.
- Prezzo modificato su eBay aggiornato su Shopify entro 5 minuti.
- Quantita modificata su eBay aggiornata su Shopify entro 5 minuti.
- Ordine Shopify pagato riduce disponibilita eBay o genera alert critico con retry.
- Modifica manuale Shopify apre conflitto.
- Listing eBay chiuso archivia prodotto Shopify.
- Regole sconto/markup/arrotondamento applicate senza modificare eBay.
- Descrizione pulita visibile in anteprima prima di applicazione massiva.
- Disinstallazione app revoca accesso e ferma sync.

## Rischi principali

- Alcuni listing eBay storici potrebbero richiedere Trading API e non Inventory API.
- Le notifiche eBay potrebbero non coprire tutti gli eventi necessari: il polling entro 5 minuti resta obbligatorio.
- Aggiornare la disponibilita eBay da ordini Shopify e il punto piu critico per ridurre vendite di prodotti non disponibili e rispettare i rate limit.
- Le descrizioni eBay possono contenere HTML pesante o template difficili da pulire senza falsi positivi.
- Le varianti complesse possono aumentare molto la complessita: vanno isolate dal MVP base.

## Fonti tecniche iniziali

- Shopify App Store reference: https://apps.shopify.com/epi
- Shopify productSet: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
- Shopify webhooks: https://shopify.dev/docs/apps/webhooks
- eBay GetSellerList: https://developer.ebay.com/devzone/XML/docs/Reference/ebay/GetSellerList.html
- eBay GetItem: https://developer.ebay.com/Devzone/XML/docs/Reference/ebay/GetItem.html
- eBay Inventory API: https://developer.ebay.com/api-docs/sell/inventory/overview.html
- eBay ItemRevised: https://developer.ebay.com/api-docs/static/pn_item-revised.html
