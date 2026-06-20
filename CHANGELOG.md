# Changelog

Tutte le modifiche significative a SyncBay sono documentate in questo file.

Il formato segue Keep a Changelog e il versionamento segue Semantic Versioning adattato a Shopify app SaaS.

## [Non rilasciato]

## [0.43.0] — 2026-06-20

### Novità

- Impostazioni: aggiunta la regola descrizione persistente per scegliere fra
  HTML pulito, HTML completo e solo testo sui nuovi import.
- Importazione: l'anteprima mostra checklist qualità esplicita e suggerimenti
  conservativi di matching con prodotti Shopify esistenti, senza merge
  automatico.
- Attività: aggiunti centro salute catalogo, stato della riconciliazione
  completa e diagnostica leggibile dei cooldown rate-limit eBay.

### Sotto il cofano

- Dati operativi: fissata la retention pilota per audit log, job, snapshot,
  state OAuth e richieste eBay account deletion.

## [0.42.13] — 2026-06-20

### Correzioni

- Webhook ordini Shopify: le quantità frazionarie vengono scartate prima di
  pianificare aggiornamenti stock eBay, evitando riduzioni non rappresentabili
  sulla disponibilità marketplace.

### Sotto il cofano

- Coda Shopify: la coalescenza dei job `DETECT_SHOPIFY_CHANGES` riconosce anche
  chiavi risorsa `admin_graphql_api_id`/`adminGraphqlApiId`, oltre a
  `resourceId` e `inventoryItemGid`.

## [0.42.12] — 2026-06-20

### Correzioni

- Catalogo: su viewport stretti la tabella resta scrollabile dentro la sezione,
  senza allargare l'intera pagina embedded Shopify.
- Attività: i job bloccati da cooldown eBay mostrano la prossima finestra di
  retry e chiariscono che il retry manuale non va forzato durante la pausa.

### Sotto il cofano

- Screenshot live: `ui:shot-live` crea la cartella `preview/shots` anche in
  checkout puliti prima di scrivere gli output ignorati da Git.
- Pulizia interna: rimosso il vecchio harness preview HTML statico, snellito
  l'handoff UI storico, documentato lo screenshot live Admin e ristrette
  interfacce TypeScript non usate fuori modulo.

## [0.42.11] — 2026-06-20

### Correzioni

- Navigazione embedded: la capsule di transizione forza lo stack sans di
  sistema, evitando il fallback serif quando l'iframe non eredita il font
  Shopify.

## [0.42.10] — 2026-06-20

### Correzioni

- Navigazione embedded: la capsule di transizione usa `s-text` Shopify per
  allineare il font al resto dell'admin, senza override tipografici custom.

## [0.42.9] — 2026-06-20

### Correzioni

- Navigazione embedded: la capsule di transizione usa una tipografia più
  vicina all'admin Shopify e rimuove la barra laterale decorativa, mantenendo
  solo l'icona animata come segnale di attività.

## [0.42.8] — 2026-06-20

### Correzioni

- Navigazione embedded: lo stato di transizione usa una capsule informativa
  coerente con SyncBay, con micro-animazione rispettosa di `prefers-reduced-motion`.

## [0.42.7] — 2026-06-20

### Correzioni

- Catalogo: i titoli della tabella dichiarano la disposizione responsive
  richiesta dai Web Components Shopify, riducendo gli avvisi Polaris in console
  Safari.

## [0.42.6] — 2026-06-20

### Correzioni

- Backfill descrizioni: l'apply da piano salvato ricontrolla mapping corrente,
  conflitti aperti e prodotto Shopify collegato prima di scrivere.

## [0.42.5] — 2026-06-20

### Correzioni

- Navigazione embedded: durante il cambio sezione viene mostrato uno stato di
  transizione comune, evitando che il contenuto precedente sembri fermo mentre
  Shopify aggiorna l'iframe.

## [0.42.4] — 2026-06-20

### Sotto il cofano

- Backfill descrizioni: aggiunti piani apply locali riusabili per riprendere
  gli aggiornamenti Shopify senza rifare una scansione eBay completa, più un
  percorso sperimentale `GetSellerList` per leggere descrizioni eBay in bulk
  prima del fallback puntuale `GetItem`.

## [0.42.3] — 2026-06-20

### Correzioni

- Panoramica: il battito del sync mantiene una sola descrizione per screen
  reader, evitando duplicazioni dopo il passaggio a semantica `figure`.
- Catalogo: l'indicatore di caricamento parziale torna a confrontare il totale
  con il limite massimo prodotti invece che con sé stesso.

### Sotto il cofano

- Catalogo: il caricamento senza ricerca o ordinamento, sui filtri semplici,
  legge solo la pagina visibile dal database e risolve le miniature solo per le
  righe mostrate.
- Lo smoke UI riconosce anche i link React Router nel menu embedded, mantenendo
  il controllo sulle stesse voci di navigazione.

## [0.42.2] — 2026-06-20

### Sotto il cofano

- CI: il workflow React Doctor usa l'action composita con Node 24 e mantiene
  il gate bloccante sui file cambiati nelle PR, evitando blocchi da backlog
  preesistente.
- React Doctor: lo score full passa a 100/100 separando il toast App Bridge dal
  file componente, usando semantica nativa per il battito del sync e
  configurando l'override mirato per gli effetti live asincroni.

## [0.42.1] — 2026-06-20

### Correzioni

- Conflitti: la risoluzione in blocco segnala gli errori inattesi invece di
  mostrare un esito riuscito quando una risoluzione sicura fallisce.

### Sotto il cofano

- Aggiornato React Doctor alla patch `0.5.8` per mantenere allineato il gate di
  qualità React.

## [0.42.0] — 2026-06-20

### Novità

- Conflitti: risoluzione in blocco dei conflitti sicuri. Con un'azione SyncBay
  sistema tutte le descrizioni in conflitto mantenendo la versione di Shopify
  come riferimento, senza toccare eBay; le scelte delicate (titoli, immagini,
  prezzi) restano da decidere una per una. Esito mostrato con un toast.
- Importazione: conferma con toast all'avvio dell'import.

### Sotto il cofano

- Microcopy dei job sincronizzazione unificato in un'unica fonte (prima
  duplicato e divergente tra Panoramica e Attività).
- Il battito del sync è ora descritto agli screen reader come immagine con
  testo equivalente.
- Rimosse le transizioni di navigazione non verificabili nell'admin embedded.
- Coperti da test la ricerca catalogo e l'aggregazione di affidabilità della
  Panoramica.

## [0.41.5] — 2026-06-19

### Sotto il cofano

- Aggiornate le dipendenze e i tool di supporto compatibili: Shopify CLI,
  parser XML eBay, rilevamento bot, TypeScript ESLint, Playwright e React
  Doctor.

## [0.41.4] — 2026-06-19

### Correzioni

- Backfill descrizioni: la descrizione Shopify svuotata manualmente non viene
  più sovrascritta dalla pulizia e gli snapshot descrizione non vengono promossi
  a baseline prezzo.

## [0.41.3] — 2026-06-19

### Correzioni

- Codex feedback: corretti i casi aperti su backfill descrizioni/faccette,
  mapping categorie Shopify, baseline stock, sorgenti prezzo da snapshot e badge
  Attività con conflitti aperti.

## [0.41.2] — 2026-06-19

### Correzioni

- Catalogo: i prodotti eBay già esauriti non gonfiano più il conteggio "Da
  controllare" solo perché la quantità dell'ultimo snapshot non è leggibile.

## [0.41.1] — 2026-06-19

### Correzioni

- Regola prezzo: l'arrotondamento all'euro non collassa più i prezzi bassi a
  `0,01` quando non esiste un euro intero positivo sotto il prezzo eBay e non
  pubblica un prezzo barrato quando l'arrotondamento non lascia uno sconto
  reale.
- Categorie Shopify: i francobolli singoli ereditano sorgente e confidenza dal
  segnale che indica davvero il dettaglio singolo, invece dalla categoria
  generica `Francobolli`.

## [0.41.0] — 2026-06-19

### Novità

- Catalogo: ricerca per titolo, SKU o ItemID eBay. Il campo di ricerca lavora
  insieme a filtri, ordinamento e paginazione, con stato vuoto dedicato quando
  non ci sono risultati.

## [0.40.5] — 2026-06-19

### Sotto il cofano

- Il backfill categorie legge i metafield prodotto `syncbay.*` già presenti su
  Shopify come sorgente cache prima di chiamare eBay Trading `GetItem`, così le
  verifiche post-apply possono evitare quote eBay quando snapshot o metafield
  contengono già le categorie sorgente.
- Il mapping categorie usa `Collectible Coins` come categoria Shopify neutra per
  le monete e sposta distinzioni come italiane, commemorative o bullion nel
  `productType`, evitando categorie troppo strette o fuorvianti come `Rare
  Coins`, `Commemorative Coins`, `Bullion Coins` e `First Day Covers` nei
  contesti numismatici.
- `npm run categories:backfill` supporta il repair esplicito dei conflitti
  generati dal vecchio mapper con
  `--repair-category-conflicts --confirm-repair-category-conflicts`, limitato a
  pattern legacy riconosciuti.
- `npm run categories:backfill` può forzare anche i conflitti categoria manuali
  solo con conferma esplicita del maintainer tramite
  `--force-category-conflicts --confirm-force-category-conflicts`.
- I cataloghi/libri cartacei con titolo esplicito, come i cataloghi di carte
  telefoniche, restano `Print Books` anche quando una categoria sorgente
  generica li collocherebbe nel collezionismo.

## [0.40.4] — 2026-06-19

### Correzioni

- Backfill descrizioni: la registrazione degli snapshot `SYNCBAY` valorizza
  esplicitamente l'id del record, evitando il fallimento dell'apply dopo la
  mutation Shopify.

## [0.40.3] — 2026-06-19

### Sotto il cofano

- Impostazioni allineata al linguaggio della Panoramica: esito dei salvataggi
  via toast (niente più messaggi inline), sezione "Collegamenti e diagnostica"
  con righe icona-led e cause chiare, scorciatoie di sola navigazione rimosse,
  badge di stato dinamico.

## [0.40.2] — 2026-06-19

### Correzioni

- Catalogo e Conflitti: ridotto l'egress Supabase evitando il caricamento della
  storia completa degli snapshot prodotto tramite relazioni Prisma; le pagine
  leggono ora solo l'ultimo snapshot utile per mapping.

### Sotto il cofano

- Aggiunto `npm run jobs:coalesce-shopify-changes`, dry-run/apply controllato
  per cancellare logicamente i job webhook Shopify duplicati mantenendo l'evento
  più recente per prodotto o inventory item.

## [0.40.1] — 2026-06-19

### Correzioni

- Margini laterali uniformi su tutte le pagine: Conflitti, Importazione,
  Attività e Impostazioni ora usano la stessa larghezza di colonna di Panoramica
  e Catalogo, eliminando i margini disallineati tra le schermate.

## [0.40.0] — 2026-06-15

### Novità

- Backfill: aggiunto `npm run facets:backfill`, dry-run/apply controllato per
  popolare sui prodotti già collegati le cinque faccette storefront
  `syncbay_facets.*` senza attivare i filtri Search & Discovery.

## [0.39.5] — 2026-06-15

### Sotto il cofano

- Attività: impaginazione uniformata alla Panoramica. Le metriche stanno
  direttamente sulla pagina (niente più riquadro che le incorniciava) e i box
  dei controlli rapidi sono ora icona-led, per un'unica lingua visiva tra le due
  pagine.

## [0.39.4] — 2026-06-15

### Correzioni

- Preview UI: il renderer crea automaticamente `preview/shots/` nei checkout
  puliti e lo smoke UI resta allineato alla microcopy corrente della pagina
  Attività.

## [0.39.3] — 2026-06-15

### Correzioni

- Descrizioni eBay: aggiunto il backfill controllato `descriptions:backfill-cleanup`
  per applicare retroattivamente la descrizione pulita ai prodotti Shopify già
  importati, con dry-run predefinito, apply confermato e skip dei conflitti
  aperti.

## [0.39.2] — 2026-06-15

### Sotto il cofano

- Attività: conferma con toast quando riprovi un aggiornamento, aggiornamento
  live della coda mentre ci sono job in corso, badge di stato a colpo d'occhio
  e microcopy più diretto. Colori coerenti con la palette eBay/Shopify della
  Panoramica.

## [0.39.1] — 2026-06-15

### Correzioni

- Regola prezzo: il riallineamento solo prezzo usa l'ultimo snapshot eBay locale
  quando la lettura live del listing non torna nel batch.

## [0.39.0] — 2026-06-15

### Novità

- Import: i nuovi prodotti possono ricevere le cinque faccette storefront
  `Categoria`, `Area / Stato`, `Materiale`, `Conservazione` e `Perizia` come
  metafield Shopify `syncbay_facets.*`, usando dati categoria, `ItemSpecifics`
  e un parser titolo conservativo per segnali numismatici come `BB`, `SPL`,
  `FDC`, `Proof`, materiali e perizia.

## [0.38.2] — 2026-06-15

### Correzioni

- Regola prezzo: i job di riallineamento creati prima del flag `pricingOnly`
  vengono riconosciuti come aggiornamenti solo prezzo quando vengono ritentati.

## [0.38.1] — 2026-06-15

### Correzioni

- Regola prezzo: il riallineamento dopo salvataggio ora aggiorna solo prezzo e
  prezzo barrato Shopify, senza passare dal sync completo di titolo,
  descrizione, media, stato e inventario.
- Regola prezzo: l'arrotondamento all'euro mantiene il prezzo scontato sotto il
  prezzo barrato Shopify anche con sconti piccoli.
- Categorie Shopify: i francobolli singoli restano classificati come single
  stamp anche quando il segnale generico arriva dalla categoria primaria e il
  dettaglio singolo arriva da titolo o categoria negozio.
- Descrizioni eBay: liste e heading già puliti restano blocchi HTML validi e
  non vengono più avvolti in paragrafi generati.

## [0.38.0] — 2026-06-15

### Novità

- Import preview: le descrizioni eBay vengono ripulite prima dell'import da
  template negozio, colori inline e markup non essenziale, con riepilogo
  prima/dopo nella card prodotto.

### Sotto il cofano

- Aggiunto il report `npm run descriptions:cleanup-report` per misurare su un
  campione eBay reale quanta descrizione viene rimossa dal cleaner, senza
  scritture su eBay o Shopify.

## [0.37.0] — 2026-06-15

### Novità

- Impostazioni: aggiunta una regola prezzo globale Shopify-only con sconto
  percentuale intero, arrotondamento a due decimali o all'euro e applicazione
  automatica ai prodotti importati o riallineati. Quando lo sconto è attivo,
  SyncBay scrive il prezzo Shopify scontato e mantiene il prezzo eBay originale
  come prezzo barrato Shopify.

### Correzioni

- Backfill categorie: il refresh Trading viene tentato quando manca la categoria
  primaria eBay, anche se esiste una categoria negozio, e la confidenza della
  proposta Shopify deriva dal segnale che ha davvero prodotto il match.

### Sotto il cofano

- Aggiunta la tabella `PricingRule` per shop e aggiornati snapshot/conflitti
  prezzo per distinguere prezzo eBay originale, prezzo Shopify calcolato e
  prezzo barrato.

## [0.36.8] — 2026-06-15

### Sotto il cofano

- Aggiunta la fondazione dry-run per il mapping categorie eBay -> Shopify:
  SyncBay propone categoria Shopify, `productType`, confidenza e sorgente nello
  snapshot diagnostico senza applicare ancora modifiche massive allo store.
- Aggiunto `npm run categories:backfill`, report dry-run read-only per
  confrontare prodotti Shopify collegati e categorie proposte da SyncBay prima
  dell'apply.
- Estesa la mappa iniziale alle categorie osservate nel campione reale:
  modellini auto e dischi musicali, mantenendo l'apply disattivato.
- Aggiunto l'apply controllato `--apply --confirm-apply`, che aggiorna su
  Shopify solo righe applicabili e salta conflitti manuali e casi incerti.
- I nuovi prodotti creati dall'import Shopify ricevono subito `category` e
  `productType` quando la proposta SyncBay è valida, senza creare tag categoria.
- Il report categorie espone il motivo dei lookup eBay falliti, così eventuali
  fallimenti Trading temporanei non sembrano conflitti o decisioni catalogo.

## [0.36.7] — 2026-06-15

### Correzioni

- Panoramica: la rivalidazione programmata per retry future usa tutta la coda
  attiva dei job `RETRYING`, non solo gli ultimi job mostrati nella cronologia.

## [0.36.6] — 2026-06-15

### Correzioni

- UI: la card di rischio disponibilità usa un bordo warning più scuro, così il
  rischio resta visibile anche sulla superficie bianca.

## [0.36.5] — 2026-06-15

### Correzioni

- Panoramica: quando l'unico lavoro attivo è una retry con `runAfter` futuro,
  la pagina programma una rivalidazione alla prossima finestra invece di
  restare ferma fino al refresh manuale.
- UI: il nodo centrale del battito completato usa il colore testuale success
  scuro sulla tinta chiara, migliorando il contrasto.

## [0.36.4] — 2026-06-15

### Sotto il cofano

- Palette dell'app allineata ai colori del logo eBay/Shopify: verde Shopify per
  il successo, blu eBay per informativo e accento primario, giallo eBay per il
  warning, rosso eBay per l'errore, con varianti scure per il testo e superfici
  neutre per la leggibilità. Accento coerente (link, stati, battito, bottoni)
  sul blu eBay.
- Aggiunto un pattern condiviso di toast per il feedback delle azioni, pronto
  per le prossime superfici. Vedi ADR 0013 e ADR 0014.

## [0.36.3] — 2026-06-15

### Correzioni

- Panoramica: le retry di aggiornamento disponibilità con `runAfter` futuro non
  mantengono più la pagina in stato di sincronizzazione in corso né il polling
  rapido fino alla finestra di esecuzione effettiva.

## [0.36.2] — 2026-06-14

### Correzioni

- Panoramica: lo stato catalogo in ritardo mostra di nuovo un avviso operativo
  e i job attivi di aggiornamento disponibilità mantengono la pagina in stato di
  sincronizzazione in corso.

### Sotto il cofano

- Aggiornato lo smoke UI della Panoramica al redesign corrente, rimuovendo
  aspettative su testi e componenti della vecchia vista tecnica.

## [0.36.1] — 2026-06-14

### Correzioni

- L'import Shopify applica ai prodotti creati solo il tag generico `Negozio
  eBay`, mantenendo la ricerca compatibile con i vecchi tag SyncBay già presenti
  per evitare duplicati.

## [0.36.0] — 2026-06-14

### Novità

- Panoramica ridisegnata: il battito del sync eBay → SyncBay → Shopify mostra a
  colpo d'occhio cosa sta facendo l'app, una lente in evidenza segnala i
  prodotti che rischiano di essere venduti senza disponibilità, le metriche
  mostrano la tendenza rispetto al giorno prima e l'affidabilità degli ultimi 7
  giorni, e i passaggi tecnici sono usciti dalla vista del negoziante. A
  catalogo vuoto la pagina diventa un primo avvio guidato (Collega → Importa →
  Attiva). Linguaggio rivisto, più concreto e meno gergale.

### Sotto il cofano

- `getDashboardState` aggrega lo storico job per ricavare i conteggi reali del
  battito (inserzioni lette/aggiornate), le tendenze a 24 ore di prodotti
  collegati e conflitti e il tasso di riuscita degli ultimi 7 giorni, senza
  introdurre nuovi worker o chiamate provider.
- Accento UI portato sul Bay Blue del logo con uso disciplinato e colori del
  design layer espressi come variabili semantiche (light, theme-ready). Vedi
  ADR 0013 e l'estensione 2026-06-14 di ADR 0010.

## [0.35.18] — 2026-06-13

### Correzioni

- Impostazioni: i componenti testuali e le griglie interne delle schede si
  restringono correttamente sui viewport stretti, evitando tagli orizzontali
  nella vista mobile.

### Sotto il cofano

- Aggiornati React, React DOM e i tipi TypeScript alla linea `19.2`, mantenendo
  il nuovo JSX transform già configurato e verificando la compatibilità dei peer
  Shopify, React Router e Vercel.

## [0.35.17] — 2026-06-13

### Sotto il cofano

- Aggiornato TypeScript alla major `6.0.3` e rimosso `baseUrl` dal
  `tsconfig`, evitando l'opzione deprecata in TypeScript 6 senza introdurre
  alias di import.

## [0.35.16] — 2026-06-13

### Correzioni

- La marcatura dei listing eBay inattivi si interrompe anche quando il mapping
  non ha ancora un prodotto Shopify collegato, evitando snapshot e chiusure
  conflitto dopo una cancellazione del job.

### Sotto il cofano

- Il gate React Doctor ignora gli artefatti locali `.shopify/`, così le chiavi
  localhost generate dalla Shopify CLI non fanno fallire la scansione locale.

## [0.35.15] — 2026-06-13

### Correzioni

- Il runner catalogo interrompe import, sync incrementali e marcatura esaurito
  se il job non è più `RUNNING` prima delle chiamate provider, evitando lavoro
  eBay/Shopify dopo una disconnessione eBay che ha già cancellato il job.

## [0.35.14] — 2026-06-13

### Sotto il cofano

- Aggiornato React Doctor a `0.5.4`, sostituendo il flag deprecato
  `--diff false` con `--scope full` nel gate `quality:react-doctor`.

## [0.35.13] — 2026-06-13

### Correzioni

- Catalogo e dashboard usano solo watermark incrementali completi per valutare
  freschezza e salute sync, evitando che un singolo batch riuscito renda fresco
  l'intero catalogo mentre altri job dello stesso ciclo sono ancora pendenti o
  falliti.

### Sotto il cofano

- Attivati i cinque future flag React Router v8 e aggiornate le route che
  leggono query string per usare l'URL normalizzato fornito dal router.

## [0.35.12] — 2026-06-13

### Correzioni

- Catalogo: lo stato "Da controllare" non scatta più sull'intero catalogo pochi
  minuti dopo ogni sincronizzazione. La staleness ora si basa sul watermark di
  verifica a livello negozio (ultimo ciclo di sync incrementale riuscito), in
  linea con la salute sync mostrata in dashboard, invece che sull'ultima
  riscrittura del singolo prodotto. Restano "Da controllare" solo i prodotti in
  pausa, mai sincronizzati o quando la verifica del catalogo contro eBay è
  realmente in ritardo.

## [0.35.11] — 2026-06-13

### Sotto il cofano

- Aggiornato Vite dalla major 6 alla major 8. Build, typecheck, lint, test e
  smoke UI verificati su Node 24; il target browser del build production resta
  invariato.
- Risolte le deprecazioni emerse con Vite 8: rimosso il plugin
  `vite-tsconfig-paths` (no-op, il `tsconfig` non definisce `paths` e non ci sono
  import con alias) e rimossa l'opzione deprecata `optimizeDeps.esbuildOptions`.
  Il pre-bundle di `@shopify/app-bridge-react` resta attivo, verificato con
  `vite optimize`.

## [0.35.10] — 2026-06-13

### Correzioni

- Ripristinato il target browser del build production Vite, mantenendo il
  workaround `esnext` solo per l'ottimizzazione locale delle dipendenze.

### Sotto il cofano

- Aggiornati i range patch/minor delle dipendenze consentite restando su Node
  24, Prisma 6, React 18, ESLint 9 e Vite 6.

## [0.35.9] — 2026-06-12

### Correzioni

- Impostazioni: schede e tile vanno a capo correttamente su viewport stretti,
  evitando contenuti percepiti come tagliati o troppo compressi.

### Sotto il cofano

- Il renderer locale del redesign resta compatibile con `esbuild 0.28.1`
  evitando trasformazioni legacy non supportate sui moduli React Router e App
  Bridge già compilati.
- Playwright è ora una dev dependency diretta, così gli script di preview e QA
  possono importarlo senza installazioni temporanee.

## [0.35.8] — 2026-06-12

### Sotto il cofano

- React Doctor è ora una dev dependency del progetto e il gate
  `quality:react-doctor` usa la config `doctor.config.json` con il flag
  `--blocking`, evitando i warning di deprecazione del runner.
- La route Impostazioni è stata divisa in sezioni React locali più piccole,
  chiudendo il warning `react-doctor/no-giant-component` e portando lo score
  React Doctor a 100/100.

## [0.35.7] — 2026-06-12

### Sotto il cofano

- Allineato il package manager canonico a `npm@11.17.0` e aggiornate le
  dipendenze patch/minor consentite dal manifest.

## [0.35.6] — 2026-06-12

### Sicurezza

- Aggiornata la risoluzione di `esbuild` a `0.28.1`, chiudendo l'advisory
  Dependabot sulla catena `@shopify/cli`/Vite senza cambiare codice runtime.

## [0.35.5] — 2026-06-12

### Correzioni

- I job catalogo oversized cancellati mentre sono in `RUNNING` non proseguono
  più con il batch completo dopo il tentativo di split, evitando write provider
  dopo una disconnessione eBay concorrente.

## [0.35.4] — 2026-06-12

### Correzioni

- Il runner finalizza o spezza un job catalogo solo se il job è ancora
  `RUNNING`, evitando che una cancellazione concorrente da scollegamento eBay
  venga sovrascritta da `SUCCEEDED`, `FAILED` o nuovi job figli.

## [0.35.3] — 2026-06-12

### Correzioni

- Scollegare eBay annulla anche i job catalogo già in esecuzione, evitando che
  il recupero dei job `RUNNING` li rimetta in coda dopo la cancellazione dei
  token.

## [0.35.2] — 2026-06-12

### Correzioni

- Impostazioni: i form dentro le schede hanno spaziatura verticale coerente, i
  badge lunghi dell'intestazione vanno a capo su viewport stretti e le schede
  `Import prodotti`/`Canali di vendita` si affiancano su desktop senza
  affollare `Sync catalogo` e `Avanzate`.
- Scollegando eBay, SyncBay annulla anche i job catalogo ancora in coda o in
  retry, evitando tentativi successivi con token già cancellati.

### Sotto il cofano

- Il renderer locale di preview e la documentazione del redesign includono ora
  anche `Impostazioni` nella copertura globale a sei superfici.

## [0.35.1] — 2026-06-12

### Correzioni

- Impostazioni considera ora gli scope Shopify `write_*` come copertura dei
  rispettivi `read_*`, così `write_files` e `write_publications` non risultano
  permessi mancanti quando la sessione offline Shopify li espone come permessi
  di scrittura.

## [0.35.0] — 2026-06-12

### Novità

- Impostazioni: il negoziante può ora **scollegare l'account eBay** dal box
  Avanzate, con conferma. La disconnessione cancella i token salvati e ferma il
  sync automatico, ma lascia su Shopify il catalogo già importato: è reversibile
  e basta ricollegare eBay per riprendere. Vedi ADR 0012.
- Impostazioni: l'**intervallo target di aggiornamento** è ora configurabile (1,
  2, 3 o 5 minuti, sempre entro il massimo di 5 minuti) e guida la cadenza del
  sync incrementale.
- Impostazioni: disattivare il sync automatico richiede ora una **conferma**
  esplicita con nota sulle conseguenze, e i dati del sync mostrano l'**ultimo
  aggiornamento** completato.

## [0.34.0] — 2026-06-12

### Novità

- Impostazioni ridisegnata: le quattro aree (Sync catalogo, Import prodotti,
  Canali di vendita, Avanzate) diventano schede con icona, titolo e badge di
  stato corrente a colpo d'occhio (Attivo/Non attivo, default prodotti, policy
  canali, collegamento eBay). I dati del sync sono tile con icona (Intervallo
  target, Prodotti collegati), i prerequisiti mancanti compaiono come avviso
  invece che come elenco, i collegamenti rapidi di Avanzate sono una lista di
  azioni con icona e i topic webhook si spostano nei dettagli tecnici. Vedi
  ADR 0010.

## [0.33.6] — 2026-06-12

### Correzioni

- Le superfici Catalogo, Conflitti, Importazione e Attività allineano badge,
  filtri e fallback immagine con il redesign embedded: Catalogo mostra un badge
  di stato sobrio, i filtri hanno respiro coerente, gli scope tecnici restano
  nei dettagli e la timeline Attività sposta codici e tentativi dietro
  disclosure.

## [0.33.5] — 2026-06-12

### Sotto il cofano

- La descrizione diagnostica della timeline Attività usa una sola passata per
  normalizzare e scartare i frammenti vuoti, chiudendo il warning React Doctor
  `react-doctor/js-flatmap-filter` senza cambiare il testo mostrato.

## [0.33.4] — 2026-06-12

### Correzioni

- La pagina Attività dà più spazio a filtri, timeline e metriche, mantiene i
  badge di stato allineati nella timeline e normalizza il testo diagnostico per
  evitare doppi punti nelle frasi composte.

## [0.33.3] — 2026-06-12

### Correzioni

- L'archiviazione dei vecchi fallimenti incrementali usa ora l'età rispetto
  all'ora corrente, non rispetto al sync riuscito più recente, così i casi
  "fallimento seguito subito da successo" diventano archiviabili dopo 24 ore.

## [0.33.2] — 2026-06-12

### Correzioni

- Il runner archivia automaticamente i vecchi fallimenti `SYNC_INCREMENTAL`
  già superati da un sync riuscito più recente, evitando che errori storici
  riappaiano come problemi operativi; aggiunto il comando
  `jobs:archive-stale-failures` per applicare la stessa regola in modo
  controllato allo storico Supabase.

## [0.33.1] — 2026-06-12

### Correzioni

- Il runner e gli script `conflicts:doctor`/`conflicts:repair-description`
  usano la stessa selezione robusta della baseline descrizione SyncBay,
  evitando falsi conflitti `description` quando l'ultima snapshot valida ha
  payload senza marker tecnici.
- La tile "Totale" del Catalogo conta solo i prodotti eBay davvero collegati a
  Shopify, mentre il totale catalogo resta nel riepilogo di paginazione.
- Lo stepper Importazione mantiene in attesa le tappe successive dopo il primo
  prerequisito ancora attivo, anche se esistono impostazioni salvate in anticipo.

## [0.33.0] — 2026-06-12

### Novità

- Attività ridisegnata come timeline operativa: ogni evento ha ora un nodo con
  icona colorata per esito (completato, in errore, in corso) e un connettore
  verticale, per leggere la cronologia a colpo d'occhio invece di una pila di
  box uguali. Le metriche in alto (In coda, Errori recenti, Eventi, Catalogo)
  sono tile con icona e tinta come nelle altre pagine, e la diagnostica resta
  sotto la timeline. Microcopy più chiaro ("Aggiornamento automatico" al posto
  di "Runner incrementale"). Retry, filtri e logica invariati. Vedi ADR 0010.

## [0.32.1] — 2026-06-12

### Correzioni

- I bottoni per salvare e rinominare la location nella pagina Importazione hanno
  ora più spazio dal campo sopra, migliorando la leggibilità del setup Shopify.
- Lo step "Anteprima catalogo" dell'importazione risulta completato solo dopo
  una preview eBay reale, evitando falsi progressi quando sono mostrati dati
  dimostrativi.
- La chiusura automatica dei conflitti `description` già riallineati non sblocca
  più mapping in stato `PAUSED` o `ERROR`, preservando i blocchi intenzionali.

## [0.32.0] — 2026-06-12

### Novità

- Catalogo: ogni riga ha ora azioni contestuali, niente più cella azioni vuota.
  "Dettagli" (sempre) apre il prodotto su Shopify o l'inserzione eBay,
  "Risolvi" appare con conflitti aperti e "Riprova" sui prodotti in errore
  (rimanda alla coda errori in Attività).

### Correzioni

- Catalogo: microcopy più diretto per il negoziante — la metrica Totale dice
  "Prodotti eBay collegati a Shopify" invece di "Mapping…", e la colonna
  Aggiornato mostra "Lettura eBay" invece di "Snapshot". La colonna dei
  collegamenti si chiama ora "Collegamento" invece di "Canali", per non
  confonderla con i canali di vendita.

## [0.31.0] — 2026-06-12

### Novità

- Importazione ridisegnata come stepper verticale guidato: le cinque tappe
  (Collegamento eBay, Preparazione Shopify, Anteprima catalogo, Importazione,
  Dopo l'import) hanno ora un nodo numerato — spuntato quando la tappa è
  completata — con connettore che dà il senso di avanzamento, e uno stato per
  tappa ("Completato", "Da fare ora", "In attesa") derivato dai dati reali del
  wizard. Le metriche dell'anteprima (Letti da eBay, Totale, Importabili,
  Errori) sono tile con icona e tinta come Panoramica e Catalogo. Azioni,
  validazioni e avvio import controllato invariati. Vedi ADR 0010.

## [0.30.2] — 2026-06-12

### Correzioni

- Il runner chiude automaticamente i falsi conflitti `description` già
  riallineati alla baseline SyncBay più recente prima che blocchino il sync
  incrementale; il doctor e la repair CLI includono anche i conflitti stale su
  mapping `OUT_OF_STOCK`/`ARCHIVED`, coerenti con la policy ADR 0011.
- La riparazione automatica delle thumbnail Catalogo torna a scorrere i mapping
  attivi più vecchi prima dei più recenti, evitando che gli stessi candidati
  senza immagini blocchino l'avanzamento del backlog giornaliero.
- I filtri della pagina Conflitti hanno più spazio dal riquadro sottostante,
  migliorando la leggibilità della coda decisioni.

## [0.30.1] — 2026-06-12

### Correzioni

- Conflitti: microcopy riscritto in lingua piana per il negoziante, meno gergo
  tecnico. Spariscono termini come "batch", "baseline", "hash", "dettagli
  tecnici" e "sovrascrittura silenziosa"; le modalità di gestione diventano
  "Sicuro", "Da rivedere" e "Da decidere"; hero, tile, testi d'impatto, pannelli
  sorgente eBay/Shopify e note di sicurezza usano frasi più dirette. Logica e
  azioni invariate.

## [0.30.0] — 2026-06-12

### Novità

- Conflitti ridisegnata con la stessa lingua visiva di Panoramica e Catalogo: la
  pagina si apre con un hero di stato (numero di conflitti da decidere o "nessuno
  in sospeso") e metriche a tile con icona e tinta semantica. Ogni conflitto è
  ora una decision card con accento tonale a sinistra keyato sulla gravità della
  scelta (batch sicuro, da rivedere, manuale); il confronto eBay/Shopify è in due
  pannelli sorgente con i marchi ufficiali, con il lato eBay evidenziato come
  sorgente di verità; l'azione "Usa valore eBay" è la primaria. Vedi ADR 0010.

## [0.29.7] — 2026-06-12

### Sotto il cofano

- Ottimizzazioni prestazionali guidate da React Doctor, senza cambiamenti di
  comportamento: formattatori `Intl.NumberFormat` portati a scope di modulo
  nelle viste embedded, await indipendenti eseguiti in parallelo su dashboard
  e reconcile catalogo, iterazioni array a passata singola e precisione SVG del
  logo ridotta a 2 decimali.
- React Doctor a 100/100: le regole async lato server con falsi positivi noti
  su codice sequenziale necessario (retry, paginazione, transazioni Prisma,
  ordinamento DB) sono escluse solo dallo score, restando attive in CLI e CI.

## [0.29.6] — 2026-06-11

### Correzioni

- La riparazione automatica delle thumbnail Catalogo scansiona tutto il
  perimetro MVP dei mapping attivi prima di applicare il limite giornaliero,
  evitando di restare bloccata su mapping già coperti da immagini.

### Sotto il cofano

- `publish:preflight --remote` riconosce `main` pulito e allineato come
  controllo post-merge, evitando blocchi falsi dopo una pubblicazione già
  completata.
- `catalog:images:doctor` carica `.env` prima di scegliere lo shop target,
  così `SHOPIFY_DEV_STORE` locale viene rispettato quando non passi `--shop`.

## [0.29.5] — 2026-06-11

### Correzioni

- Il runner usa i cicli delta eBay senza eventi per pianificare una riparazione
  idempotente delle thumbnail mancanti nel Catalogo, limitata per ItemID/giorno
  e basata sullo stesso flusso `SYNC_INCREMENTAL` che sincronizza i media.

### Sotto il cofano

- Aggiunto `npm run catalog:images:doctor`, diagnostica in sola lettura per
  misurare la copertura immagini degli snapshot e verificare se eBay live
  restituisce immagini per righe ancora senza thumbnail in SyncBay.

## [0.29.4] — 2026-06-11

### Correzioni

- Il delta eBay `GetSellerEvents` avanza il watermark solo dopo il successo di
  tutti i job della finestra, inclusi i listing inattivi da mettere in esaurito,
  evitando di perdere chiusure eBay in finestre miste.
- La messa in esaurito di un listing inattivo usa la variante Shopify salvata
  nel mapping invece della prima variante del prodotto, quando disponibile.
- Panoramica applica gli stessi header embedded `no-store` delle altre route
  app.

## [0.29.3] — 2026-06-11

### Correzioni

- Le categorie negozio eBay con ID placeholder (`0`/`-999`) non conservano più
  un nome categoria senza ID reale nei payload SyncBay e nella diagnostica
  orfani.

## [0.29.2] — 2026-06-11

### Correzioni

- Catalogo: filtri e paginazione mantengono i vecchi ordinamenti decrescenti
  `sort`/`dir` anche quando non esiste un equivalente nel parametro compatto
  `order`.

## [0.29.1] — 2026-06-11

### Correzioni

- Catalogo: i vecchi link con `sort` e `dir=desc` mantengono l'ordinamento
  decrescente anche dopo l'introduzione del nuovo parametro compatto `order`.

## [0.29.0] — 2026-06-11

### Novità

- Catalogo: controlli compatti con chip per filtri e ordine, 50 prodotti per
  pagina, link Shopify/eBay come azioni di riga, tabella più larga e colonna
  Azioni separata dallo Stato.
- QA UI: il render locale con fixture sintetica supporta Panoramica e Catalogo,
  genera screenshot senza Supabase o Shopify Admin e resta affiancato al render
  con dati reali quando serve.

## [0.28.1] — 2026-06-11

### Correzioni

- I prodotti con mapping `OUT_OF_STOCK`, `ARCHIVED`, `PAUSED` o `ERROR` non
  generano più nuovi conflitti Shopify; eventuali conflitti aperti vengono
  chiusi quando il listing eBay esce dalla sorgente attiva.
- Il sync incrementale non viene più bloccato da conflitti aperti storici su
  mapping non attivi, così un listing eBay tornato attivo può rientrare e
  ripristinare scorta e stato Shopify.

### Sotto il cofano

- Aggiunto `npm run catalog:backfill-archived-soldout`, backfill una-tantum che
  porta i prodotti già archiviati per listing eBay inattivo allo stato esaurito
  di ADR 0011 (prodotto Shopify riattivato con scorta 0, politica DENY e tag
  `esaurito`; mapping a `OUT_OF_STOCK` con snapshot). Idempotente, con
  `--dry-run`, eseguito sul pilota per i 132 prodotti archiviati storici.
- Il backfill aggiorna il database solo se il mapping è ancora `ARCHIVED` al
  momento della scrittura, evitando di sovrascrivere rientri o stati concorrenti.

## [0.28.0] — 2026-06-11

### Novità

- Catalogo: colonne ordinabili cliccando le intestazioni (Prodotto,
  Collegamento, Disponibilità, Prezzo, Aggiornamento, Stato), con direzione
  asc/desc e ordinamento preservato cambiando filtro o pagina.
- Catalogo: immagine e prodotto in due colonne separate; il prezzo usa il
  simbolo di valuta (€) invece del codice; le azioni di riga sono contestuali
  (Risolvi appare solo con conflitti aperti, Dettagli sempre disponibile).

### Correzioni

- Catalogo: filtri e cambi pagina più veloci — le miniature vengono risolte
  solo per le righe mostrate invece che per tutto il catalogo caricato.

## [0.27.0] — 2026-06-10

### Novità

- Catalogo: quando un listing eBay diventa inattivo, il prodotto Shopify non
  viene più archiviato ma mantenuto in vetrina come esaurito (scorta 0, politica
  "non vendere a scorta zero", tag `esaurito`), così l'URL e l'indicizzazione SEO
  della pagina restano. Se il listing eBay torna attivo, il prodotto viene
  ripristinato (scorta e tag). La corsia catalogo prima chiamata "Archiviati" ora
  è "Esauriti". Vedi ADR 0011.

## [0.26.0] — 2026-06-10

### Novità

- Catalogo: stessa lingua visiva della Panoramica — le metriche (Totale,
  Aggiornati, Da controllare, Archiviati) sono ora tile con icona e tinta
  semantica, con layout e spaziatura coerenti. La tabella prodotti resta
  invariata (table-first).

## [0.25.0] — 2026-06-09

### Novità

- Panoramica: "Azioni consigliate" è ora una lista di righe cliccabili con
  icona, etichetta e breve descrizione (es. conteggio conflitti da rivedere),
  più chiara e meno spoglia della precedente fila di pulsanti.

## [0.24.3] — 2026-06-09

### Correzioni

- Panoramica: la fascia delle metriche ora ha lo stesso spazio delle altre aree
  rispetto alle sezioni sottostanti (rimosso `block-size:100%` sulle tile, che
  faceva debordare la fascia nel gap rendendola attaccata).

## [0.24.2] — 2026-06-09

### Correzioni

- Panoramica: separazione esplicita tra la fascia delle metriche e le sezioni
  sottostanti, che restavano visivamente attaccate nonostante l'aumento di gap.

## [0.24.1] — 2026-06-09

### Correzioni

- Panoramica: piu' spazio tra la fascia delle metriche e le sezioni "Azioni
  consigliate" e "Stato catalogo", che apparivano appiccicate.
- Il pannello collegamenti mostra "eBay IT" invece di "eBay EBAY_IT".

## [0.24.0] — 2026-06-09

### Novità

- Panoramica ridisegnata come centro operativo: hero di stato con la prossima
  azione, fascia di metriche con icone, layout multi-regione responsivo e
  pannello collegamenti con i marchi ufficiali eBay e Shopify come indicatori
  sobri di sorgente e destinazione.
- Introdotto un design layer minimo e documentato (ADR 0010) sopra i Polaris
  Web Components: tile metrica, hero di stato e scheda connessione, con uso di
  `s-icon` prima assente.

### Sotto il cofano

- Ambiente di preview UI locale: render headless delle superfici embedded con
  dati reali via Vite SSR (`npm run ui:render`), harness con stand-in dei
  componenti Polaris e seed locale dello stato collegato (`npm run ui:seed-local`).

## [0.23.18] — 2026-06-07

### Sotto il cofano

- Aggiunto `npm run ebay:store-category-orphans`, diagnostica in sola lettura
  che per ogni mapping ACTIVE chiama Trading API `GetItem` e segnala i listing
  attivi senza categoria del negozio (non visibili nella vetrina pubblica eBay).
  Non scrive su eBay né sui dati prodotto e aggiorna solo il token eBay cifrato
  se scaduto.

## [0.23.17] — 2026-06-07

### Correzioni

- Il sync incrementale propaga `storeCategoryId` e `storeCategoryName` lungo
  l'enqueue dei candidati: la serializzazione nel payload del job
  `SYNC_INCREMENTAL` e la successiva deserializzazione conservano i due campi,
  altrimenti gli snapshot eBay generati dal runner restavano senza categoria
  del negozio anche quando Trading API la restituiva.

## [0.23.16] — 2026-06-07

### Sotto il cofano

- Gli snapshot eBay (`ProductSnapshot.payload`) registrano `storeCategoryId` e
  `storeCategoryName` quando il listing eBay è assegnato a una categoria del
  negozio, normalizzando i placeholder eBay `0`/`-999` a "nessuna categoria".
  Abilita diagnostiche del tipo "quali listing attivi non sono nella vetrina
  pubblica eBay" senza dover interrogare di nuovo Trading API.

## [0.23.15] — 2026-06-07

### Correzioni

- Il rilevatore conflitti non apre più un conflitto `images` quando la baseline
  SyncBay registra zero immagini eBay e Shopify ne conserva delle proprie:
  evita rumore sistemico nella coda Conflitti coerentemente con la regola
  "eBay sorgente di verità".

## [0.23.14] — 2026-06-05

### Correzioni

- Le superfici embedded usano Polaris Web Components per badge, metriche,
  filtri, tabelle, stati vuoti e controlli form, riducendo il CSS custom
  SyncBay al solo styling minimo dei dettagli tecnici nativi `details/summary`.
- Reintrodotti segnali brand SyncBay nel perimetro nativo Shopify: pannello con
  logo reale e tagline in Panoramica/pagine pubbliche, badge accessori
  `s-page` e microcopy operativo ricorrente.
- Le pagine pubbliche Accesso, Informazioni e Privacy usano Polaris Web
  Components non embedded invece di CSS module, inline style e controlli HTML
  custom.

## [0.23.13] — 2026-06-05

### Correzioni

- Il doctor locale richiede `SHOPIFY_APP_URL` per allinearsi al runtime
  Shopify, senza accettare `APP_URL` come fallback non usato dall'app.

## [0.23.12] — 2026-06-05

### Correzioni

- I prodotti già archiviati sia in SyncBay sia in Shopify non aprono più
  conflitti quantità quando la baseline eBay è 0 ma Shopify conserva una
  disponibilità residua non vendibile.

### Sotto il cofano

- Il doctor locale riconosce `SHOPIFY_APP_URL` e `SHOPIFY_SCOPES` come env
  Shopify primarie, mantenendo `APP_URL` e `SCOPES` come fallback compatibili.
- Il preflight remoto fallisce se non riesce a leggere la Codex feedback inbox
  o se la sezione `Da risolvere ora` contiene thread actionable.

## [0.23.11] — 2026-06-05

### Sotto il cofano

- Aggiunti doctor locali per toolchain, conflitti/stale e preflight
  pubblicazione, così i casi ricorrenti vengono rilevati prima di PR/merge o
  retry operativo.

## [0.23.10] — 2026-06-05

### Correzioni

- La pagina Conflitti classifica le decisioni aperte tra `Batch sicuri`, `Da
  rivedere` e `Manuali`, marcando anche la sicurezza delle singole azioni.
- La pagina Attività mostra impatto, prossima azione e riferimento tecnico dei
  job, bloccando il retry manuale quando eBay ha imposto un cooldown.
- La diagnostica retry riconosce anche i cooldown eBay registrati come
  fallimento di enqueue incrementale.
- La repair CLI dei conflitti descrizione conserva le baseline correnti degli
  altri campi quando crea una nuova baseline descrizione.

### Sotto il cofano

- Brand e handoff UI includono regole di microcopy e sequenza screenshot
  prodotto per le sei superfici embedded.

## [0.23.9] — 2026-06-05

### Correzioni

- Rimossa la barra brand aggiunta sopra l'app embedded: SyncBay resta esposto
  nei titoli, nelle icone e nella navigazione nativa senza comprimere il logo
  orizzontale dentro una shell custom.

## [0.23.8] — 2026-06-05

### Correzioni

- La shell embedded mostra il logo reale SyncBay, le pagine principali
  impostano titoli browser con suffisso `SyncBay`, il root HTML pubblica
  favicon e icone brand approvate e la voce `Panoramica` resta visibile nel
  menu separando il link home tecnico `rel="home"` dalla voce navigabile.

## [0.23.7] — 2026-06-05

### Correzioni

- Il rilevatore conflitti Shopify usa solo baseline descrizione SyncBay valide,
  chiude automaticamente i conflitti già riallineati e la repair CLI distingue
  i falsi conflitti descrizione da chiudere da quelli che richiedono una nuova
  baseline.

## [0.23.6] — 2026-06-05

### Correzioni

- La Panoramica non propone più `Ricollega eBay` tra le azioni consigliate
  quando l'account eBay risulta già collegato.
- La pagina Attività espone `Conflitti` come filtro operativo, include i
  conflitti recenti nella timeline e riduce i residui `Audit` visibili al
  negoziante.

## [0.23.5] — 2026-06-04

### Correzioni

- Le pagine embedded Catalogo, Conflitti, Attività, Importazione e Impostazioni
  inviano header `no-store`, evitando risposte stale su dati negoziante
  autenticati.
- La pagina Conflitti usa conteggi reali per aperti, risolti e totale coda,
  mostra 25 decisioni per pagina e non espone hash descrizione come valori
  leggibili dal negoziante.
- L'anteprima Importazione mostra 10 elementi per pagina e preserva i filtri
  senza creare una lista troppo lunga da revisionare.
- Impostazioni chiarisce che il conteggio mostrato è quello dei prodotti attivi
  collegati.

## [0.23.4] — 2026-06-04

### Correzioni

- Il Catalogo usa filtro e paginazione nella vista dati, con conteggio totale
  reale dei mapping, evitando di nascondere prodotti oltre la prima pagina.
- L'Importazione mostra il collegamento eBay solo quando l'OAuth è configurato
  e abilitato, sostituendo il link non avviabile con un blocco operativo.

## Note interne non versionate

### 2026-06-12

- Esteso l'harness locale di preview alle superfici Catalogo, Conflitti,
  Importazione, Attività e Panoramica, e riallineata la documentazione del
  redesign escludendo Impostazioni dal ciclo corrente.

### 2026-06-11

- Chiarito nelle istruzioni agenti e nella toolchain che Codex può usare anche
  il plugin Shopify disponibile per questo tool e questa repo, come supporto
  operativo non runtime.

### 2026-06-10

- CI: il workflow `Codex PR comments` ora ritenta anche i `401` transitori di
  GitHub con messaggio `Requires authentication` (oltre a `Bad credentials`),
  evitando che un blip lato GitHub sulle chiamate GraphQL faccia fallire il job
  della inbox Codex feedback.

### 2026-06-04

- Verificato il trigger reale `orders/paid` via Shopify Admin `orderCreate` sul
  dev store: il job `UPDATE_EBAY_STOCK` allowlistato aggiorna eBay e il rollback
  ripristina eBay, Shopify e configurazione Vercel.

## [0.23.3] — 2026-06-04

### Correzioni

- Il Catalogo e la pagina Conflitti usano le immagini READY già presenti su
  Shopify come fallback quando gli snapshot SyncBay non contengono URL media,
  evitando placeholder vuoti per prodotti già importati con immagini.

## [0.23.2] — 2026-06-04

### Correzioni

- Le miniature Catalogo e Conflitti usano l'ultimo payload immagine disponibile
  per mapping, anche quando lo snapshot più recente non contiene dati media.

## [0.23.1] — 2026-06-04

### Correzioni

- Il Catalogo embedded legge le miniature prodotto dai payload snapshot e
  conserva gli URL immagine eBay negli snapshot import, evitando placeholder
  vuoti quando l'import ha già letto immagini valide.

## [0.23.0] — 2026-06-04

### Novità

- Avviata la Fase 1 del redesign UI SyncBay: nuova navigazione embedded,
  sistema visivo condiviso e Panoramica centrata sulla prossima azione operativa.
- Avviata la Fase 2 del redesign UI SyncBay con nuove pagine Catalogo e
  Conflitti collegate a selector Prisma reali e azioni di risoluzione esistenti.
- Avviata la Fase 3 del redesign UI SyncBay con Importazione riorganizzata in
  step progressivi e Impostazioni divise nei quattro box confermati.
- Aggiunta la pagina Attività del redesign UI SyncBay con timeline di job,
  audit recenti, filtri e retry dei job falliti.

## [0.22.25] — 2026-06-03

### Sotto il cofano

- La readiness `orders:paid-readiness` segnala i cooldown Trading API eBay
  registrati nei job SyncBay e blocca il test Admin `orderCreate` finché la
  finestra di retry non è raggiunta.

## [0.22.24] — 2026-06-03

### Sotto il cofano

- Aggiunto un endpoint diagnostico interno Shopify Admin protetto da
  `APP_SECRET` e usato da `import:verify`, così la verifica campione import non
  dipende più dall'OAuth volatile di `shopify store auth`.

## [0.22.23] — 2026-06-03

### Correzioni

- I delta `GetSellerEvents` successivi a una riconciliazione completa usano il
  timestamp di lettura catalogo eBay come watermark, non il tempo di
  completamento del job locale.

## [0.22.22] — 2026-06-03

### Sotto il cofano

- La readiness `orders:paid-readiness` verifica anche usabilità e scadenza dei
  token eBay, evitando falsi verdi quando lo stock runner richiederebbe una
  riconnessione eBay prima di aggiornare le disponibilità.

## [0.22.21] — 2026-06-03

### Correzioni

- Il watermark dei delta `GetSellerEvents` usa la sorgente riuscita più recente
  tra riconciliazione completa e delta eBay.
- Le finestre seller-events con soli listing da archiviare avanzano il
  watermark solo dopo il completamento dei job `ARCHIVE_INACTIVE_LISTING`.

## [0.22.20] — 2026-06-03

### Sotto il cofano

- La readiness `orders:paid-readiness` controlla anche la connessione eBay
  `EBAY_IT`, evitando di dichiarare pronto un test `orders/paid` quando lo
  stock runner fallirebbe prima di aggiornare eBay.

## [0.22.19] — 2026-06-03

### Correzioni

- Il watermark dei delta eBay avanza dal `ModTimeTo` processato, non dal tempo
  di completamento del job, evitando buchi tra finestre `GetSellerEvents`.
- I delta eBay composti solo da listing inattivi registrano un marker
  `SYNC_INCREMENTAL` riuscito, evitando archiviazioni duplicate della stessa
  finestra.

## [0.22.18] — 2026-06-03

### Sotto il cofano

- Il runner incrementale usa Trading API `GetSellerEvents` per i delta recenti
  e conserva `GetMyeBaySelling` come riconciliazione completa periodica,
  riducendo il consumo di `GetItem` nei cicli ordinari.

## [0.22.17] — 2026-06-03

### Sotto il cofano

- Aggiunta la diagnostica `ebay:rate-limits` per misurare i limiti reali eBay
  Trading applicativi e per utente; il runner ora programma il retry dopo il
  reset giornaliero Trading quando eBay segnala quota esaurita.

## [0.22.16] — 2026-06-03

### Correzioni

- La dashboard usa solo l'ultimo `SYNC_INCREMENTAL` riuscito per calcolare la
  freschezza del catalogo, così un marker di cooldown fallito non appare come
  sync recente.

## [0.22.15] — 2026-06-03

### Correzioni

- Le pianificazioni incrementali eBay fallite prima della creazione dei batch
  registrano un job `SYNC_INCREMENTAL` fallito, così il runner rispetta il
  cooldown configurato e non richiama eBay ogni minuto durante un rate limit.
- La deduplica dei job `UPDATE_EBAY_STOCK` considera i risultati `planned`
  precedenti solo per righe ancora in dry-run, evitando di bloccare una futura
  scrittura reale contro una vecchia simulazione.

## [0.22.14] — 2026-06-03

### Correzioni

- I job `UPDATE_EBAY_STOCK` riconoscono come già gestite anche le righe ordine
  pianificate in dry-run da job riusciti precedenti, evitando doppie
  pianificazioni quando Shopify consegna `orders/paid` duplicati.

## [0.22.13] — 2026-06-03

### Sotto il cofano

- Aggiunta la readiness operativa `orders:paid-readiness` per controllare
  sessione offline Shopify, scope ordini, coda stock/sync e candidati con
  snapshot `EUR` prima della prova reale `orders/paid`.
- La configurazione Shopify richiede anche `write_orders` per abilitare una
  prova automatica controllata via Admin `orderCreate` sul dev store.

## [0.22.12] — 2026-06-03

### Correzioni

- Il runner non considera più sane le sessioni offline Shopify legacy senza
  scadenza: i job automatici richiedono token offline a scadenza con refresh,
  in linea con il requisito Shopify public app 2027.

### Sotto il cofano

- Aggiunto l'ADR sui token offline Shopify a scadenza come requisito operativo
  per import, sync e archiviazioni automatiche.

## [0.22.11] — 2026-06-03

### Correzioni

- Il runner aggiorna automaticamente i token offline Shopify a scadenza usando
  il refresh token salvato, evitando blocchi 401 nelle attività automatiche.

## [0.22.10] — 2026-06-03

### Correzioni

- L'import di prodotti `ACTIVE` con pubblicazione canali `SELECTED` usa i GID
  canale salvati nelle impostazioni SyncBay senza ricaricare le publications
  Shopify a ogni job runner.

## [0.22.9] — 2026-06-03

### Correzioni

- Il backoff GraphQL Shopify tollera envelope `errors` non conformi e non
  manda più in errore il runner quando Shopify restituisce una risposta
  inattesa.

## [0.22.8] — 2026-06-03

### Correzioni

- Il runner chiude come fallite anche le tracce interne `draft-import` rimaste
  `RETRYING` oltre la finestra stale, evitando residui non schedulabili nella
  coda import.
- Il client Admin GraphQL offline riconosce anche `extensions.code:
  "THROTTLED"` come segnale di throttling Shopify e applica il backoff.

## [0.22.7] — 2026-06-03

### Correzioni

- Il client Admin GraphQL offline del runner ritenta throttling e risposte HTML
  transitorie di Shopify, restituendo sempre un envelope JSON ai servizi di
  import/sync.

## [0.22.6] — 2026-06-03

### Sotto il cofano

- Lo script operativo `products:publish-channel` salta i prodotti già pubblicati
  sul canale target e applica retry/backoff quando Shopify rallenta le mutation.

## [0.22.5] — 2026-06-03

### Correzioni

- Il runner automatico usa il token offline Shopify salvato nel database per le
  chiamate Admin GraphQL, evitando che errori transitori dello storage sessioni
  blocchino import, sync incrementali, archiviazioni e controlli conflitti.

## [0.22.4] — 2026-06-03

### Correzioni

- Il runtime Prisma aggiunge parametri conservativi al `DATABASE_URL` quando
  non sono già espliciti, riducendo la pressione di connessioni verso il pooler
  Supabase nelle funzioni serverless.

## [0.22.3] — 2026-06-03

### Correzioni

- Il runner chiude come fallite le tracce interne `draft-import` rimaste
  `RUNNING` oltre la finestra stale, evitando diagnostiche live bloccate da
  sotto-operazioni già abbandonate.

## [0.22.2] — 2026-06-03

### Correzioni

- Il runner automatico spezza i job eBay -> Shopify troppo grandi in batch da
  10 ItemID e non tratta più i job interni di import Shopify come lavori
  schedulabili, riducendo timeout e blocchi della coda cron.
- La pubblicazione automatica sui canali Shopify parte solo dopo un sync scorte
  Shopify riuscito per i prodotti `ACTIVE`, evitando prodotti visibili con
  disponibilità non confermata.

## [0.22.1] — 2026-06-03

### Correzioni

- La lettura dei canali Shopify usa `catalog.title` quando disponibile e ricade
  su `Publication.name` quando Shopify non espone un titolo catalogo, così
  `Online Store` resta selezionabile nelle Impostazioni e negli script
  operativi.
- Lo script `products:publish-channel` usa il token offline dell'app installata
  invece dell'autenticazione Shopify CLI, evitando falsi blocchi sugli scope
  publication dopo il re-consenso dello store.

## [0.22.0] — 2026-06-02

### Novità

- I prodotti Shopify importati o riallineati come `ACTIVE` seguono una nuova
  policy canali in Impostazioni: tutti i canali disponibili, solo canali
  selezionati o nessuna pubblicazione automatica; la pubblicazione usa
  `publishablePublish` e le bozze restano non pubblicate.

### Sotto il cofano

- Aggiunti gli scope Shopify `read_publications` e `write_publications` alla
  configurazione runtime, alla readiness dashboard e alla documentazione
  provisioning.
- Aggiunta la migration Prisma per salvare modalità e canali Shopify selezionati
  per singolo shop.
- Aggiunto lo script operativo `products:publish-channel` per pubblicare una
  tantum i prodotti SyncBay attivi su un canale Shopify specifico e salvare la
  policy canali dello shop.

## [0.21.1] — 2026-06-02

### Correzioni

- Il runner recupera tutti i job SyncBay rimasti `RUNNING` oltre la finestra di
  sicurezza, non solo gli import, evitando che un timeout Vercel lasci bloccati
  i batch incrementali e la coda automatica.
- La riconciliazione catalogo automatica aspetta che gli import iniziali
  pendenti, in retry o in esecuzione siano chiusi prima di pianificare nuovi
  batch incrementali.

## [0.21.0] — 2026-06-02

### Novità

- Il runner automatico ora riconcilia il catalogo attivo eBay via Trading API
  a ogni finestra incrementale: pianifica batch `SYNC_INCREMENTAL` anche per
  nuovi listing non ancora mappati e crea job `ARCHIVE_INACTIVE_LISTING` per i
  mapping non più attivi solo quando la scansione eBay è completa entro il
  limite MVP.

### Correzioni

- Le risoluzioni `KEEP_SHOPIFY` su conflitti non descrizione preservano la
  baseline descrizione reale più recente, evitando falsi conflitti descrizione
  quando lo snapshot scelto è uno snapshot stock parziale.

### Sotto il cofano

- Aggiunta la spec operativa per il test end-to-end controllato dei flussi
  eBay -> Shopify e ordine Shopify -> disponibilità eBay, con baseline e
  rollback obbligatori.
- Documentato l'esito del test controllato: sync quantità eBay -> Shopify
  verificato con rollback; runner stock Shopify -> eBay verificato con payload
  ordine sintetico, allowlist singola e rollback; trigger da vendita Shopify
  reale ancora da provare con scope `write_orders`/token offline.
- Rafforzato lo script operativo di ripristino stock eBay con parsing argomenti
  testabile, preferenza Portachiavi per `TOKEN_ENCRYPTION_KEY` e opzione
  `--skip-snapshot` per simulare modifiche eBay esterne senza inquinare il
  baseline SyncBay.
- Estratto e testato il parser dei webhook Shopify `orders/paid` e
  `inventory_levels/update`, così la trasformazione payload -> job stock eBay
  resta coperta anche senza ripetere subito un ordine Shopify reale.
- Aggiunto il controllo embedded in Impostazioni per attivare o disattivare il
  sync catalogo automatico, con blocco dell'attivazione finché mancano account
  eBay collegato, location Shopify predefinita o prodotti importati.
- Aggiunta diagnostica dashboard per il sync catalogo incrementale: stato
  fresco/in corso/in ritardo, ultimo completamento e prossima finestra target.

## [0.20.12] — 2026-06-02

### Correzioni

- Gli snapshot creati da `KEEP_SHOPIFY` non ereditano più marker di stock
  parziali e restano baseline descrizione valide anche dopo aggiornamenti stock
  Shopify.

## [0.20.11] — 2026-06-02

### Correzioni

- Il detector dei conflitti descrizione conserva come baseline valida anche una
  descrizione Shopify volutamente vuota, ignorando solo gli snapshot stock
  parziali quando cerca la baseline descrizione più recente.

## [0.20.10] — 2026-06-02

### Correzioni

- Il detector dei conflitti stock e `import:verify` trattano una location
  predefinita SyncBay senza inventory level Shopify come disallineamento,
  invece di ricadere sull'inventario aggregato della variante.

## [0.20.9] — 2026-06-02

### Correzioni

- Lo script di ripristino stock eBay conserva `TOKEN_ENCRYPTION_KEY` già
  configurata, usa Supabase CLI via `npx` e scrive lo snapshot SyncBay solo dopo
  aver verificato che eBay esponga la disponibilità richiesta.
- Il detector dei conflitti Shopify cerca la baseline SyncBay più recente per
  singolo campo senza fermarsi ai primi 50 snapshot parziali, evitando falsi
  conflitti dopo molte variazioni stock.

## [0.20.8] — 2026-06-02

### Correzioni

- La verifica import e il detector dei conflitti stock confrontano la quantità
  Shopify sulla location predefinita SyncBay, evitando falsi disallineamenti
  quando l'inventario aggregato Shopify differisce dalla location gestita.

## [0.20.7] — 2026-06-02

### Sotto il cofano

- Gli script diagnostici `jobs:status` e `import:verify` riconoscono anche le
  run import in cui `catalogImportRunId` è nullo, usando l'id del job import
  come fallback.
- Gli snapshot SyncBay salvano la baseline descrizione dall'HTML restituito da
  Shopify, evitando falsi conflitti quando Shopify normalizza la descrizione
  importata.
- Il detector dei conflitti Shopify usa l'ultima baseline non vuota per campo,
  evitando falsi conflitti su stato, immagini o altri campi quando l'ultimo
  snapshot SyncBay è parziale.
- Aggiunto lo script `npm run conflicts:repair-description` per riparare in
  modo controllato i falsi conflitti descrizione già aperti.

## [0.20.6] — 2026-06-02

### Correzioni

- Il dry-run stock eBay può restare attivo globalmente mentre una allowlist
  runtime abilita scritture reali mirate per singolo shop, item eBay o variante
  Shopify durante i test controllati.
- Gli aggiornamenti stock Trading API conservano gli SKU eBay reali anche quando
  coincidono con il formato fallback `EBAY-<ItemID>`, omettendo lo SKU solo se
  lo snapshot segnala che è stato generato da SyncBay.

## [0.20.5] — 2026-06-02

### Correzioni

- Gli aggiornamenti stock eBay tramite Trading API non inviano più lo SKU
  fallback `EBAY-<ItemID>` generato da SyncBay, evitando errori su inserzioni
  eBay senza gestione per SKU.

## [0.20.4] — 2026-06-01

### Correzioni

- Il guard valuta dei job `UPDATE_EBAY_STOCK` considera la valuta presentment
  dell'ordine Shopify prima della valuta base dello store, evitando di applicare
  riduzioni stock eBay.it su ordini pagati o presentati in una valuta diversa
  da EUR.

### Sotto il cofano

- Aggiunta l'icona vettoriale monocromatica per la navigazione Shopify agli
  asset brand e al relativo manifest.

## [0.20.3] — 2026-06-01

### Correzioni

- I job `UPDATE_EBAY_STOCK` supportano il dry-run runtime
  `SYNCBAY_EBAY_STOCK_DRY_RUN=true`, che pianifica la riduzione stock senza
  chiamare eBay e senza scrivere snapshot di stock fittizi.
- Per eBay.it il runner stock applica solo ordini e snapshot catalogo in EUR e
  salta le righe con valuta mancante o diversa, evitando aggiornamenti stock
  eBay incoerenti con il marketplace.

### Sotto il cofano

- Preview Inventory/Trading API e import Shopify salvano la valuta del catalogo
  negli snapshot prodotto, così i job stock possono validarla prima di chiamare
  eBay.

## [0.20.2] — 2026-06-01

### Correzioni

- La coalescenza dei webhook Shopify non può più riportare a `PENDING` un job
  `DETECT_SHOPIFY_CHANGES` già claimato dal runner; se il job è stato preso in
  carico, il webhook crea una nuova verifica pendente.

## [0.20.1] — 2026-06-01

### Correzioni

- I webhook Shopify `products/update` e `inventory_levels/update` coalescono i
  job `DETECT_SHOPIFY_CHANGES` pendenti per risorsa, evitando accumuli massivi
  durante import o aggiornamenti a raffica.
- Il runner preleva i job dovuti in ordine di priorità già dalla query,
  impedendo a una coda vecchia di conflitti Shopify di ritardare i job
  `UPDATE_EBAY_STOCK`.
- Il controllo idempotente dei retry `UPDATE_EBAY_STOCK` cerca la riga ordine
  già processata senza limitarsi agli ultimi snapshot disponibili.

### Sotto il cofano

- Gli script diagnostici Supabase usano `SUPABASE_DB_PASSWORD` o il Portachiavi
  macOS come fallback sicuro, e `npm run jobs:status` mostra anche la coda
  complessiva oltre all'ultima run import.
- `.env.example` allinea gli scope OAuth runtime includendo `read_orders`.

## [0.20.0] — 2026-06-01

### Novità

- Riattivata la subscription Shopify `orders/paid` e lo scope `read_orders`
  dopo la scelta della distribuzione personalizzata, per abilitare il job
  `UPDATE_EBAY_STOCK` nel pilota controllato.

## [0.19.1] — 2026-06-01

### Correzioni

- Il manifest Shopify pilota resta deployabile senza `read_orders` e senza
  subscription `orders/paid`, che richiedono approvazione Shopify per protected
  customer data; il codice `UPDATE_EBAY_STOCK` resta pronto ma non attivato dal
  manifest finché l'approvazione non è disponibile.
- `npm run import:verify` ora confronta lo stato prodotto Shopify con
  `productStatus` dello snapshot SyncBay invece di assumere sempre `ACTIVE`,
  evitando falsi fallimenti per import configurati come bozze.
- I retry dei job `UPDATE_EBAY_STOCK` saltano le righe ordine già applicate
  nello stesso job, evitando doppie riduzioni della disponibilità eBay.
- L'azione conflitto `Mantieni Shopify` aggiorna la baseline SyncBay del campo,
  così il sync incrementale successivo non annulla la scelta del negoziante.

## [0.19.0] — 2026-06-01

### Novità

- Il runner pianifica job `SYNC_INCREMENTAL` per shop con sync attivo, in batch
  da 50 mapping, e riallinea i prodotti Shopify da eBay entro il target di
  polling configurato.
- Il webhook `orders/paid` crea job prioritari `UPDATE_EBAY_STOCK` che riducono
  la disponibilità eBay tramite Trading API `ReviseInventoryStatus`.
- I webhook Shopify product/inventory aprono conflitti `SyncConflict` quando
  rilevano drift rispetto all'ultimo snapshot SyncBay; la dashboard mostra i
  conflitti e offre azioni guidate.

### Correzioni

- I prodotti riusati vengono riallineati anche su titolo e descrizione eBay,
  non solo stato, prezzo, SKU, media e inventario.

## [0.18.8] — 2026-06-01

### Correzioni

- L'import Shopify aggiorna prezzo e SKU della variante per prodotti creati o
  riusati, invece di salvare il prezzo eBay solo negli snapshot/metafield.
- I retry manuali dalla dashboard ripartono con tentativi azzerati, risultato
  precedente pulito e budget minimo riallineato; i batch catalogo e gli import
  Shopify delegati hanno un tentativo in più per assorbire recuperi stale del
  runner.
- Il riuso prodotti mantiene il fallback di scansione `tag:SyncBay` sul
  metafield `syncbay.ebay_item_id`, evitando duplicati quando manca un mapping
  locale e l'handle Shopify è stato modificato.

### Sotto il cofano

- La dashboard mostra l'avanzamento dell'ultima run import con conteggi per
  batch catalogo/import Shopify, job attivi, job falliti e problemi recenti.
- Aggiunto `npm run import:verify` per confrontare un campione dell'ultima run
  tra snapshot eBay/SyncBay, mapping e prodotti Shopify live senza richiedere
  `DATABASE_URL` locale.
- Aggiunto `npm run import:repair-commercial-fields` per riallineare prezzo e
  SKU variante Shopify dai dati dell'ultima run import.

## [0.18.7] — 2026-06-01

### Correzioni

- L'import Shopify applica retry/backoff sulle risposte Admin GraphQL
  `Throttled` e cerca i prodotti già importati tramite mapping SyncBay prima
  del fallback per handle, riducendo il consumo di rate limit durante i batch
  catalogo.

## [0.18.6] — 2026-06-01

### Sotto il cofano

- Aggiunto il comando `npm run jobs:status` per diagnosticare gli import
  catalogo dal database Supabase remoto senza richiedere `DATABASE_URL` locale
  o stampare segreti.

## [0.18.5] — 2026-06-01

### Correzioni

- La rimozione dei media Shopify gestiti da SyncBay usa ora la mutazione
  `productDeleteMedia`, compatibile con Admin GraphQL `2026-04`, evitando il
  blocco dei retry import su `ProductUpdateInput.mediaIdsToDelete`.

## [0.18.4] — 2026-06-01

### Correzioni

- I rilanci dello stesso import catalogo completato usano ora uno scope
  idempotente nuovo per l'import Shopify delegato, senza consumare il budget
  retry dei tentativi precedenti.
- Il reset dei batch import catalogo è ora condizionato allo stato terminale
  atteso, evitando di riportare a `PENDING` un job già claimato dal runner.

### Sotto il cofano

- Aggiunti gli asset icona quadrata SyncBay 1200 px nelle varianti trasparente
  e bianca al manifest brand.

## [0.18.3] — 2026-06-01

### Correzioni

- Allineata la versione Admin GraphQL runtime a `2026-04`, coerente con la
  configurazione webhook e con la sintassi inventario `changeFromQuantity`.

## [0.18.2] — 2026-06-01

### Sotto il cofano

- Documentato l'uso operativo del Shopify AI Toolkit come supporto per sviluppo
  assistito su superfici Shopify, senza introdurlo come dipendenza runtime.
- Allineata la Shopify CLI locale del progetto alla versione globale `4.1.0`.

## [0.18.1] — 2026-06-01

### Correzioni

- I batch import catalogo già completati vengono ripianificati quando il
  negoziante rilancia l'import sugli stessi listing attivi, così eventuali
  prodotti eBay corretti dopo un primo skip vengono riletti.

## [0.18.0] — 2026-06-01

### Novità

- L'import catalogo può ora pianificare batch `IMPORT_CATALOG` fino al limite
  MVP di 2.000 listing attivi, fermandosi prima quando lo store eBay collegato
  espone meno prodotti.

## [0.17.6] — 2026-05-31

### Correzioni

- Il runner recupera i job import `RUNNING` stantii prima di cercare nuovi job
  dovuti, così anche un import rimasto bloccato senza job successivi viene
  riportato a retry o fallimento.

## [0.17.5] — 2026-05-31

### Correzioni

- Il runner recupera i job import rimasti `RUNNING` oltre la finestra di
  sicurezza prima di bloccare nuovi claim dello stesso shop, evitando code
  congelate dopo timeout o interruzioni di processo.

## [0.17.4] — 2026-05-31

### Correzioni

- Il runner dei job import non claimma più un secondo import dello stesso shop
  mentre un import precedente è ancora `RUNNING`, preservando la
  serializzazione per shop anche tra invocazioni Cron sovrapposte.

## [0.17.3] — 2026-05-31

### Correzioni

- Il runner dei job import claimma ora ogni job subito prima dell'esecuzione,
  così le notifiche eBay account deletion possono cancellare correttamente i
  job ancora in coda senza riscritture successive.
- La preview eBay passa ora al fallback Trading API quando Inventory API legge
  solo risultati non importabili, invece di fermarsi su una preview senza
  prodotti utilizzabili.
- La challenge eBay account deletion risponde ora con il campo JSON
  `challengeResponse` richiesto da eBay.
- I warning sulla verifica quantità Shopify dopo aggiornamenti concorrenti
  vengono propagati nel risultato import senza segnare il job come fallito.

### Sotto il cofano

- Ridotte le attese sequenziali nel runner import, nella sincronizzazione media
  Shopify e nella pulizia eBay account deletion, mantenendo claim atomico,
  concorrenza controllata e isolamento per shop.
- Configurato il quality gate React Doctor per usare sempre
  `react-doctor@latest`.

## [0.17.2] — 2026-05-26

### Sotto il cofano

- Aggiornato il floor Node a `>=24.15 <25` per consentire l'upgrade della
  catena React Doctor mantenendo `engine-strict=true`.
- Pinnata l'immagine Docker a `node:24.16.0-alpine`, così anche il container
  rispetta lo stesso floor Node della toolchain locale.

## [0.17.1] — 2026-05-26

### Correzioni

- Aggiunta la direttiva Shopify `@idempotent` ai campi mutation inventario
  `inventoryActivate` e `inventorySetQuantities`, richiesta dalla Admin API
  2026-04 per evitare rifiuti runtime sui prossimi import.
- Rimossa la proprietà non supportata `ignoreCompareQuantity` dall'input
  `inventorySetQuantities`, allineando la mutation allo schema Admin GraphQL
  corrente letto via Shopify CLI.
- L'aggiornamento quantità legge ora la disponibilità corrente Shopify e la
  passa come `changeFromQuantity`, richiesta dalla mutation
  `inventorySetQuantities`.

## [0.17.0] — 2026-05-26

### Novità

- L'import Shopify copia ora tutte le immagini eBay disponibili fino al limite
  media Shopify per ogni prodotto creato o riusato da SyncBay.
- Quando Shopify rifiuta una URL immagine eBay diretta, SyncBay scarica
  temporaneamente l'immagine nel bucket privato Supabase Storage
  `syncbay-import-staging`, genera una URL firmata e riprova la creazione media
  su Shopify.

### Sotto il cofano

- Aggiunti gli scope Shopify `read_files` e `write_files` alla configurazione
  app, così SyncBay può rimuovere media prodotto precedenti durante il
  riallineamento immagini.

## [0.16.1] — 2026-05-26

### Correzioni

- L'import Shopify riallinea ora anche lo stato dei prodotti SyncBay già
  esistenti quando vengono riusati, così il default `Pubblicato` non lascia
  prodotti in bozza su reinvii o retry.
- La sincronizzazione inventario verifica ora dopo le mutation Shopify che il
  tracking sia davvero attivo e che la quantità disponibile sulla location
  predefinita corrisponda al valore eBay.

## [0.16.0] — 2026-05-26

### Novità

- L'import Shopify attiva ora il tracking scorte, collega l'inventory item alla location Shopify predefinita e imposta la quantità disponibile usando il valore letto da eBay per prodotti creati o riusati.

### Correzioni

- Il mapping e lo snapshot SyncBay salvano ora anche il `shopifyVariantGid`, necessario per i prossimi sync stock e per audit più precisi.
- Spostata l'estensione Supabase `pg_net` fuori dallo schema `public`, ricreandola nello schema `extensions` e mantenendo disponibili le funzioni `net.http_post` usate dalla schedule Cron.

### Sotto il cofano

- Allineata la configurazione React Doctor alla nuova route Impostazioni React Router e rimossa l'esportazione inutilizzata del default stato prodotti.

## [0.15.0] — 2026-05-26

### Novità

- Aggiunta l'area embedded `/app/settings` per scegliere il default stato prodotti dei nuovi import Shopify.
- I nuovi import usano ora `Pubblicato` come default runtime, con override `Bozza` salvabile per shop.

### Correzioni

- Aggiornata la preview import e la dashboard per mostrare il nuovo default prodotti senza parlare solo di bozze quando lo shop importa in stato pubblicato.
- Ridotte le query Prisma concorrenti della dashboard embedded per evitare errori runtime `EMAXCONNSESSION` su Supabase session mode durante il caricamento di `/app`.
- Allineato il build runtime a `prisma generate` prima della build React Router, così Vercel non distribuisce un Prisma Client obsoleto dopo modifiche allo schema `Shop`.

## [0.14.0] — 2026-05-26

### Novità

- Portato il batch draft pilota a 50 prodotti, aggiornando il limite runtime e il corrispondente valore di ambiente.

### Correzioni

- Verificato sul dev store l'import reale da 50 listing con esito idempotente: 26 nuove bozze Shopify, 24 riusi senza duplicati e mapping presenti per tutti gli `ItemID` del batch.

## [0.13.1] — 2026-05-26

### Correzioni

- Il runner `/api/jobs/run-due` riprende i job `IMPORT_CATALOG` leggendo i listing richiesti via eBay Trading API `GetItem` per `ItemID`, evitando falsi fallimenti dovuti alla preview live paginata.
- I job automatici completati dal runner aggiornano ora il record originale con esito finale e non restano bloccati in stato `RUNNING`.

## [0.13.0] — 2026-05-26

### Novità

- Aggiunto un runner protetto `/api/jobs/run-due` per riprendere job `IMPORT_CATALOG` dovuti usando la sessione Shopify offline e la preview eBay live.
- Portato il limite tecnico dell'import draft pilota a 25 prodotti per proseguire la scala controllata dopo il batch 10 verificato.

## [0.12.0] — 2026-05-26

### Novità

- La dashboard embedded mostra lo storico dell'import controllato, i conteggi di mapping/snapshot e permette di rimettere in coda i job riprogrammabili.
- L'import draft Shopify pianifica retry con backoff quando un batch fallisce prima di esaurire i tentativi.

## [0.11.1] — 2026-05-26

### Correzioni

- Corretto il submit delle form embedded della preview import, così la creazione delle bozze Shopify passa dall'action React Router senza perdere la richiesta nell'iframe Shopify.

## [0.11.0] — 2026-05-26

### Novità

- L'import draft Shopify registra ora un job `IMPORT_CATALOG` idempotente, mapping prodotto eBay -> Shopify, snapshot e audit log per ogni bozza creata o riusata.

## [0.10.3] — 2026-05-26

### Correzioni

- Corretta la microcopy dell'esito import draft Shopify, evitando il testo ambiguo `Create` e descrivendo correttamente anche il riuso di bozze esistenti.

## [0.10.2] — 2026-05-26

### Correzioni

- Reso idempotente l'import draft Shopify pilota: SyncBay riusa una bozza già presente per lo stesso eBay ItemID invece di creare duplicati su reinvii della form embedded.

## [0.10.1] — 2026-05-25

### Correzioni

- L'import draft Shopify mostra l'esito della creazione dentro la pagina embedded e crea le bozze senza immagini quando Shopify rifiuta le URL media esterne del listing.

## [0.10.0] — 2026-05-25

### Novità

- Arricchiti i primi 10 listing della preview Trading API con `GetItem`, recuperando dettagli e immagini quando `GetMyeBaySelling` restituisce dati ridotti senza appesantire il batch pilota.
- Introdotta la policy SKU fallback `EBAY-<ItemID>` per listing storici senza SKU eBay, visibile come nota nella preview.
- Limitato l'import draft pilota con `SYNCBAY_DRAFT_IMPORT_LIMIT`, includendo descrizione, prime immagini e metadati SyncBay/eBay nelle bozze Shopify create.

## [0.9.0] — 2026-05-25

### Novità

- Aggiunto fallback eBay Trading API `GetMyeBaySelling` alla preview live: se Inventory API non restituisce prodotti importabili, SyncBay prova a leggere i listing attivi storici/Seller Hub in sola lettura.

## [0.8.1] — 2026-05-25

### Correzioni

- Impostato esplicitamente `Accept-Language` nelle chiamate eBay Inventory API per evitare il rifiuto della preview live su `EBAY_IT`.

## [0.8.0] — 2026-05-25

### Novità

- Collegata la preview import alla lettura live eBay Inventory API quando l'account eBay è connesso, con refresh sicuro dell'access token e fallback mock solo se eBay non è collegato.

### Correzioni

- Rimossa la falsa diagnostica `read_locations` mancante quando Shopify restituisce lo scope `write_locations` come scope effettivo della sessione.

### Sotto il cofano

- Documentato il limite della preview live: Inventory API copre inventory item con offer pubblicate, mentre i listing storici creati da Seller Hub/UI richiedono ancora fallback Trading API.
- Aggiornato lo smoke UI per verificare la preview import generica invece della vecchia label mock-only.

## [0.7.2] — 2026-05-25

### Sicurezza

- Implementato il POST eBay marketplace account deletion con verifica `X-EBAY-SIGNATURE`, public key eBay cacheata, idempotenza e cleanup dei dati eBay collegati allo shop.
- Ridotti gli scope OAuth eBay MVP a Identity readonly e Inventory readonly/write, con recupero del `userId` immutabile durante il collegamento account.

## [0.7.1] — 2026-05-25

### Correzioni

- Aggiunto alias `/ebay/account-deletion` per configurare eBay marketplace account deletion con un endpoint pubblico dedicato.

## [0.7.0] — 2026-05-25

### Novità

- Aggiunta una pagina pubblica `/about` dedicata alla configurazione branding eBay.

## [0.6.0] — 2026-05-24

### Correzioni

- L'import draft Shopify ora limita le creazioni concorrenti per ridurre il rischio di saturare la Admin API durante verifiche pilota.
- La callback OAuth eBay consuma lo state prima dello scambio token, impedendo riutilizzi dello stesso state anche se il token exchange fallisce.
- Rafforzata la rinomina location Shopify bloccando richieste su location non più leggibili o diverse dalla predefinita salvata.
- La lettura delle location Shopify ora pagina oltre le prime 50 location, evitando falsi blocchi su shop con molte sedi.
- L'import draft Shopify ora fallisce esplicitamente su errori GraphQL top-level, HTTP non OK o prodotto non restituito.

### Novità

- La dashboard embedded mostra anche la data build accanto alla versione app.
- Aggiunta gestione Shopify della location selezionata nella preview import, con rinomina tramite `write_locations`.
- Rifinita la preview mock per renderla verificabile senza collegamenti esterni reali e con messaggi più espliciti su validazioni e scritture Shopify.
- Ripuliti i riferimenti eBay residui dai messaggi dei dati mock della preview, mantenendo sospeso il filone integrazione.

### Sotto il cofano

- Allineata l'immagine Docker base a Node 24 per rispettare `engines.node` con `engine-strict=true`.
- Rimossi export e utility non usati per riportare React Doctor a 100/100.
- Allineato l'engine Node dichiarato al requisito minimo di React Doctor.
- Portato React Doctor a 100/100 correggendo warning reali di performance, server waterfall e accessibilità senza soppressioni.
- Ridotti i warning di build Vercel limitando l'engine Node, aggiornando ESLint a flat config e filtrando i chunk vuoti attesi delle resource route server-side.
- Applicate su Supabase le migration remote per primitive runtime e mapping/snapshot/conflitti, mantenendo disabilitato l'import Shopify draft.
- Rilasciata la configurazione Shopify app `syncbay-2` con URL Vercel e rimossa l'opzione CLI non più supportata `include_config_on_deploy`.
- Evitato il falso blocco readiness quando Shopify restituisce scope `write_*` che coprono anche la lettura richiesta dalla diagnostica.
- Preparata l'azione controllata per creare bozze Shopify da preview mock, ancora bloccata dal feature flag `SYNCBAY_DRAFT_IMPORT_ENABLED`.
- Aggiunto `write_locations` agli scope Shopify pilota per consentire future modifiche controllate alle location.
- Aggiunto `npm run smoke:ui` come smoke test leggero per dashboard, preview mock e gestione location.

## [0.5.0] — 2026-05-10

### Novità

- Aggiunta preview mock con dati fittizi per testare validazioni e conteggi senza keyset eBay.
- Aggiunti modelli Prisma e migration per mapping prodotto, snapshot prodotto e conflitti Shopify.
- Preparata la base di import Shopify in `draft` dietro feature flag `SYNCBAY_DRAFT_IMPORT_ENABLED=false`.
- Rafforzata la dashboard job con conteggi per stato e diagnostica dei job falliti.

## [0.4.0] — 2026-05-10

### Novità

- Aggiunta la base di validazione dry-run per preview import, con conteggi, regole MVP e readiness delle fasi runtime successive.

### Correzioni

- La pagina import preview ora mostra un blocco guidato se lo shop non ha ancora concesso `read_locations`, invece di fallire con errore generico.
- I listing con soli warning restano importabili nella preview dry-run; i warning vengono conteggiati senza bloccare l'import.

## [0.3.0] — 2026-05-10

### Novità

- Aggiunto il wizard iniziale `/app/import-preview` per salvare la location Shopify predefinita e mostrare il dry-run import bloccato in modo esplicito.

### Correzioni

- Rafforzata la readiness dashboard: gli scope Shopify concessi dalla sessione sono verificati separatamente dagli scope configurati, e Vercel non risulta pronto se `SHOPIFY_APP_URL` manca.
- Impedito il salvataggio di una location Shopify non attiva o non abilitata agli ordini online come location predefinita.

## [0.2.0] — 2026-05-10

### Novità

- Aggiunta readiness dashboard per Shopify, Supabase, Vercel, eBay, privacy e import preview.
- Aggiunto endpoint preparatorio `/webhooks/ebay/account-deletion` con challenge response per eBay marketplace account deletion.

### Sotto il cofano

- Documentato che le notifiche account deletion restano disabilitate finché non sono pronte verifica firma e cancellazione dati.
- Consolidati i default onboarding/import preview e lo stato Shopify/Supabase/Vercel nella dashboard embedded.
- Corretto `npm run start` per trovare il server entrypoint generato dal preset Vercel/React Router.

## [0.1.6] — 2026-05-10

### Sotto il cofano

- Risolto l'alert Dependabot su `ajv` forzando la dipendenza transitive vulnerabile di `@vercel/static-config` a una versione patchata.

## [0.1.5] — 2026-05-10

### Correzioni

- Ristretta la privacy policy provvisoria ai token eBay effettivamente cifrati da SyncBay.

### Sotto il cofano

- Aggiunto ADR 0007 per documentare razionale, limiti e durata della privacy policy provvisoria del pilota.

## [0.1.4] — 2026-05-10

### Sotto il cofano

- Integrati Vercel Web Analytics e Speed Insights nella root React Router.
- Aggiunti script di verifica Supabase/Prisma e una migration per abilitare `pgmq`, `pg_cron`, la coda `syncbay_jobs` e il bucket privato `syncbay-import-staging`.
- Documentato il blocco eBay provvisorio: RuName SyncBay predisposto, OAuth non abilitato sul keyset FiscalBay e verifica end-to-end rinviata al keyset dedicato.

## [0.1.3] — 2026-05-10

### Correzioni

- Configurato il preset ufficiale Vercel per React Router, così le route pubbliche e server-side vengono servite correttamente su Vercel.

## [0.1.2] — 2026-05-10

### Sotto il cofano

- Aggiunta una pagina privacy pubblica provvisoria per configurare il RuName eBay production di SyncBay.

## [0.1.1] — 2026-05-10

### Correzioni

- Normalizzato il topic dei webhook Shopify dal formato enum al formato path e usato l'ID consegna webhook come chiave di idempotenza dei job placeholder.

### Sotto il cofano

- Documentata e attivata la procedura di versioning locale in linea con Pratix.
- Bonificati accenti e apostrofi nei testi di progetto.

## [0.1.0] — 2026-05-10

### Novità

- Prima dashboard embedded SyncBay in Shopify Admin, con stato Shopify/eBay, prossime azioni, audit e base tecnica.
- Connessione Shopify custom app verificata sul development store `syncbay-dev.myshopify.com`.

### Sotto il cofano

- Avviata la documentazione di fondazione: piano prodotto/tecnico, benchmark competitivo, ADR stack, roadmap, AGENTS, README e struttura docs.
- Aggiunte decisioni aperte, checklist pre-scaffold, governance servizio, guida Git/pubblicazione e security policy.
- Definito il branding iniziale SyncBay con `BRAND.md` e ADR dedicato.
- Consolidato il logo definitivo Catalog Bridge con asset SVG, PNG, favicon, combinati e manifest in `brand/assets/`.
- Creato il repository GitHub privato `max23468/SyncBay` e documentato il remote iniziale.
- Aggiunti issue template, PR template e configurazione GitHub iniziale in linea con le repo operative esistenti.
- Formalizzata la policy di pubblicazione GitHub, PR, commit, changelog e versioning futuro con ADR dedicato.
- Configurati Dependabot per GitHub Actions e workflow `Codex PR comments`, con inbox dedicata ai feedback sulle PR.
- Definiti i prerequisiti account Shopify/eBay, gli scope MVP, i webhook minimi e le env var previste prima dello scaffold.
- Collegata Shopify CLI all'app `SyncBay` e configurato il development store `syncbay-dev.myshopify.com`.
- Allineato lo stato dei prerequisiti eBay: account Developer confermato e keyset/app SyncBay richiesto a eBay.
- Chiuse le decisioni tecniche bloccanti con ADR infrastruttura runtime MVP: Vercel + Supabase, Prisma, Supabase Queues/Cron e storage temporaneo immagini.
- Creati e collegati i progetti runtime minimi Vercel `syncbay` e Supabase `mgjcbuokppfnglsftsmi`, senza deploy production.
- Creato lo scaffold Shopify CLI React Router TypeScript con Prisma session storage, dashboard embedded minima e webhook base.
- Rimossi gli alert Dependabot su `lodash` e `minimatch` aggiornando il tooling ESLint e rimuovendo il codegen GraphQL Shopify non ancora usato.
- Reso non bloccante il workflow `Codex PR comments` quando GitHub nega la scrittura dell'inbox/commento automatico.
- Aggiornata la configurazione Dependabot per monitorare anche le dipendenze npm introdotte dallo scaffold.
- Allineata la distribuzione Shopify dello scaffold alla fase pilota custom app tramite `AppDistribution.SingleMerchant`.
- Adattato lo scaffold a SyncBay con dashboard, schema Prisma iniziale, webhook Shopify placeholder e documentazione runtime aggiornata.
- Applicate le migration Prisma su Supabase e implementato il flusso OAuth eBay con state temporaneo, token exchange e cifratura token.
- Ridotto il manifest Shopify pilota agli scope e webhook che non richiedono protected customer data, mantenendo `orders/paid` preparato lato route ma non sottoscritto.

[Non rilasciato]: #non-rilasciato
[0.43.0]: #0430--2026-06-20
[0.42.13]: #04213--2026-06-20
[0.42.12]: #04212--2026-06-20
[0.42.7]: #0427--2026-06-20
[0.42.6]: #0426--2026-06-20
[0.42.5]: #0425--2026-06-20
[0.42.4]: #0424--2026-06-20
[0.42.3]: #0423--2026-06-20
[0.42.2]: #0422--2026-06-20
[0.42.1]: #0421--2026-06-20
[0.42.0]: #0420--2026-06-20
[0.41.5]: #0415--2026-06-19
[0.41.4]: #0414--2026-06-19
[0.41.3]: #0413--2026-06-19
[0.41.2]: #0412--2026-06-19
[0.41.1]: #0411--2026-06-19
[0.41.0]: #0410--2026-06-19
[0.40.5]: #0405--2026-06-19
[0.40.4]: #0404--2026-06-19
[0.40.3]: #0403--2026-06-19
[0.40.2]: #0402--2026-06-19
[0.40.1]: #0401--2026-06-19
[0.40.0]: #0400--2026-06-15
[0.39.5]: #0395--2026-06-15
[0.39.4]: #0394--2026-06-15
[0.39.3]: #0393--2026-06-15
[0.39.2]: #0392--2026-06-15
[0.39.1]: #0391--2026-06-15
[0.39.0]: #0390--2026-06-15
[0.38.2]: #0382--2026-06-15
[0.38.1]: #0381--2026-06-15
[0.38.0]: #0380--2026-06-15
[0.37.0]: #0370--2026-06-15
[0.36.8]: #0368--2026-06-15
[0.36.7]: #0367--2026-06-15
[0.36.6]: #0366--2026-06-15
[0.36.5]: #0365--2026-06-15
[0.36.4]: #0364--2026-06-15
[0.36.3]: #0363--2026-06-15
[0.36.2]: #0362--2026-06-14
[0.36.1]: #0361--2026-06-14
[0.36.0]: #0360--2026-06-14
[0.35.18]: #03518--2026-06-13
[0.35.17]: #03517--2026-06-13
[0.35.16]: #03516--2026-06-13
[0.35.15]: #03515--2026-06-13
[0.35.14]: #03514--2026-06-13
[0.35.13]: #03513--2026-06-13
[0.35.12]: #03512--2026-06-13
[0.35.11]: #03511--2026-06-13
[0.35.10]: #03510--2026-06-13
[0.35.9]: #0359--2026-06-12
[0.35.8]: #0358--2026-06-12
[0.35.7]: #0357--2026-06-12
[0.35.6]: #0356--2026-06-12
[0.35.5]: #0355--2026-06-12
[0.35.4]: #0354--2026-06-12
[0.35.3]: #0353--2026-06-12
[0.35.2]: #0352--2026-06-12
[0.35.1]: #0351--2026-06-12
[0.35.0]: #0350--2026-06-12
[0.34.0]: #0340--2026-06-12
[0.33.6]: #0336--2026-06-12
[0.33.5]: #0335--2026-06-12
[0.33.4]: #0334--2026-06-12
[0.33.3]: #0333--2026-06-12
[0.33.2]: #0332--2026-06-12
[0.33.1]: #0331--2026-06-12
[0.33.0]: #0330--2026-06-12
[0.32.1]: #0321--2026-06-12
[0.32.0]: #0320--2026-06-12
[0.31.0]: #0310--2026-06-12
[0.30.2]: #0302--2026-06-12
[0.30.1]: #0301--2026-06-12
[0.30.0]: #0300--2026-06-12
[0.29.7]: #0297--2026-06-12
[0.29.6]: #0296--2026-06-11
[0.29.5]: #0295--2026-06-11
[0.29.4]: #0294--2026-06-11
[0.29.3]: #0293--2026-06-11
[0.29.2]: #0292--2026-06-11
[0.29.1]: #0291--2026-06-11
[0.29.0]: #0290--2026-06-11
[0.28.1]: #0281--2026-06-11
[0.28.0]: #0280--2026-06-11
[0.27.0]: #0270--2026-06-10
[0.26.0]: #0260--2026-06-10
[0.25.0]: #0250--2026-06-09
[0.24.3]: #0243--2026-06-09
[0.24.2]: #0242--2026-06-09
[0.24.1]: #0241--2026-06-09
[0.24.0]: #0240--2026-06-09
[0.23.18]: #02318--2026-06-07
[0.23.17]: #02317--2026-06-07
[0.23.16]: #02316--2026-06-07
[0.23.15]: #02315--2026-06-07
[0.23.14]: #02314--2026-06-05
[0.23.13]: #02313--2026-06-05
[0.23.12]: #02312--2026-06-05
[0.23.11]: #02311--2026-06-05
[0.23.10]: #02310--2026-06-05
[0.23.9]: #0239--2026-06-05
[0.23.8]: #0238--2026-06-05
[0.23.7]: #0237--2026-06-05
[0.23.6]: #0236--2026-06-05
[0.23.5]: #0235--2026-06-04
[0.23.4]: #0234--2026-06-04
[0.23.3]: #0233--2026-06-04
[0.23.2]: #0232--2026-06-04
[0.23.1]: #0231--2026-06-04
[0.23.0]: #0230--2026-06-04
[0.22.25]: #02225--2026-06-03
[0.22.24]: #02224--2026-06-03
[0.22.19]: #02219--2026-06-03
[0.22.18]: #02218--2026-06-03
[0.22.17]: #02217--2026-06-03
[0.22.16]: #02216--2026-06-03
[0.22.15]: #02215--2026-06-03
[0.22.14]: #02214--2026-06-03
[0.22.13]: #02213--2026-06-03
[0.22.12]: #02212--2026-06-03
[0.22.11]: #02211--2026-06-03
[0.22.10]: #02210--2026-06-03
[0.22.9]: #0229--2026-06-03
[0.22.8]: #0228--2026-06-03
[0.22.7]: #0227--2026-06-03
[0.22.6]: #0226--2026-06-03
[0.22.5]: #0225--2026-06-03
[0.22.4]: #0224--2026-06-03
[0.22.3]: #0223--2026-06-03
[0.22.2]: #0222--2026-06-03
[0.22.1]: #0221--2026-06-03
[0.22.0]: #0220--2026-06-02
[0.21.1]: #0211--2026-06-02
[0.21.0]: #0210--2026-06-02
[0.20.12]: #02012--2026-06-02
[0.20.11]: #02011--2026-06-02
[0.20.10]: #02010--2026-06-02
[0.20.9]: #0209--2026-06-02
[0.20.8]: #0208--2026-06-02
[0.20.7]: #0207--2026-06-02
[0.20.6]: #0206--2026-06-02
[0.20.5]: #0205--2026-06-02
[0.20.4]: #0204--2026-06-01
[0.20.3]: #0203--2026-06-01
[0.20.2]: #0202--2026-06-01
[0.20.1]: #0201--2026-06-01
[0.20.0]: #0200--2026-06-01
[0.19.1]: #0191--2026-06-01
[0.19.0]: #0190--2026-06-01
[0.18.8]: #0188--2026-06-01
[0.18.7]: #0187--2026-06-01
[0.18.6]: #0186--2026-06-01
[0.18.5]: #0185--2026-06-01
[0.18.4]: #0184--2026-06-01
[0.18.3]: #0183--2026-06-01
[0.18.2]: #0182--2026-06-01
[0.18.1]: #0181--2026-06-01
[0.18.0]: #0180--2026-06-01
[0.17.6]: #0176--2026-05-31
[0.17.5]: #0175--2026-05-31
[0.17.4]: #0174--2026-05-31
[0.17.3]: #0173--2026-05-31
[0.17.2]: #0172--2026-05-26
[0.17.1]: #0171--2026-05-26
[0.17.0]: #0170--2026-05-26
[0.16.1]: #0161--2026-05-26
[0.16.0]: #0160--2026-05-26
[0.15.0]: #0150--2026-05-26
[0.14.0]: #0140--2026-05-26
[0.13.1]: #0131--2026-05-26
[0.13.0]: #0130--2026-05-26
[0.12.0]: #0120--2026-05-26
[0.11.1]: #0111--2026-05-26
[0.11.0]: #0110--2026-05-26
[0.10.3]: #0103--2026-05-26
[0.10.2]: #0102--2026-05-26
[0.10.1]: #0101--2026-05-25
[0.10.0]: #0100--2026-05-25
[0.9.0]: #090--2026-05-25
[0.8.1]: #081--2026-05-25
[0.8.0]: #080--2026-05-25
[0.7.2]: #072--2026-05-25
[0.7.1]: #071--2026-05-25
[0.7.0]: #070--2026-05-25
[0.6.0]: #060--2026-05-24
[0.5.0]: #050--2026-05-10
[0.4.0]: #040--2026-05-10
[0.3.0]: #030--2026-05-10
[0.2.0]: #020--2026-05-10
[0.1.6]: #016--2026-05-10
[0.1.5]: #015--2026-05-10
[0.1.4]: #014--2026-05-10
[0.1.3]: #013--2026-05-10
[0.1.2]: #012--2026-05-10
[0.1.1]: #011--2026-05-10
[0.1.0]: #010--2026-05-10
