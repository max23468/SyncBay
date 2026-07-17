# Handoff concept UI SyncBay

Data: 2026-06-03

Questo documento recupera e consolida il lavoro delle chat Codex
`019e8e55-b6cb-77b0-852c-232f05d9eca2` e
`019e8ec8-ebb0-70d3-b770-2d9e667117b1`.

Scopo: non perdere le decisioni prese sui concept grafici dell'app embedded
SyncBay, fissare il set di riferimento usato per l'implementazione e conservare
in calce la trascrizione testuale dei due thread recuperati.

## Stato del lavoro

- Il recupero iniziale del 2026-06-03 era ancora in fase di concept; dal
  2026-06-04 il redesign è stato implementato e pubblicato nel pilota Vercel.
- I PNG statici costruiti manualmente con logo reale sono stati scartati dal
  maintainer e non vanno usati come base.
- La base finale recuperata è Image Gen, con correzioni successive e copia
  versionabile nella repo.
- Il logo generato da Image Gen può essere impreciso: in implementazione va
  sostituito con gli asset reali SyncBay in `brand/assets/svg/` o
  `brand/assets/png/`.
- I sei concept sono reference direzionali, non specifiche pixel-perfect. Il
  piano scritto, i componenti Shopify reali e i contratti dati prevalgono sui
  dettagli generati.
- La Fase 0 documentale sui contratti dati è stata completata prima delle
  modifiche runtime: loader, action, dati disponibili, dati mancanti, stati
  vuoti e rischi sono mappati nel piano UI.
- Le fasi 1-4 sono state implementate e pubblicate:
  - Fase 1: nav embedded, sistema visivo condiviso e `Panoramica`;
  - Fase 2: nuove route `Catalogo` e `Conflitti`, collegate a selector Prisma
    reali e all'action esistente di risoluzione conflitti;
  - Fase 3: `Importazione` riorganizzata in step progressivi e `Impostazioni`
    rese coerenti con i quattro box verticali confermati;
  - Fase 4: `Attività` introdotta come timeline operativa con diagnostica
    secondaria.
- Fase 5, revisione post-publish del 2026-06-05: QA/documentale e controllo
  contro i sei concept completati; i residui visibili rilevati sono stati
  chiusi nella patch runtime `0.23.6`.
- Follow-up 2026-06-12: il cleanup runtime `0.33.6` ha chiuso i residui del
  redesign globale su `Catalogo`, `Conflitti`, `Importazione` e `Attività`.
- Follow-up Impostazioni 2026-06-12: `0.34.0` ha riallineato la pagina alle
  schede operative del design layer; `0.35.0` ha aggiunto disconnessione eBay,
  intervallo sync configurabile, conferma disattivazione e ultimo sync.

## Note implementative

- `Catalogo` è table-first, con thumbnail quando disponibile dal payload
  snapshot, primo campo `Prodotto`, filtri separati dall'importazione e una sola
  colonna `Stato`.
- `Conflitti` apre di default sui conflitti aperti, tiene la storia risolta come
  filtro secondario e usa le tre azioni confermate: `Usa valore eBay`,
  `Mantieni Shopify`, `Ignora campo`.
- I nuovi selector runtime non aggiungono schema, provider, worker o integrazioni:
  leggono `ProductMapping`, `ProductSnapshot` e `SyncConflict`.
- `Importazione` mantiene le action esistenti per location, rinomina location e
  pianificazione import catalogo; `Impostazioni` mantiene i salvataggi sync,
  default prodotto e canali.
- La QA visuale post-publish è stata eseguita nel contesto Shopify Admin
  production del precedente ambiente pilota con Safari/Computer Use sulle sei route embedded.
  L'avvio standalone resta utile solo per debug locale: le superfici embedded
  vanno giudicate dentro Shopify Admin.

## Fonti recuperate

- Chat originale:
  `/Users/Matteo/.codex/archived_sessions/rollout-2026-06-03T18-34-02-019e8e55-b6cb-77b0-852c-232f05d9eca2.jsonl`
- Thread ponte:
  `/Users/Matteo/.codex/archived_sessions/rollout-2026-06-03T20-39-52-019e8ec8-ebb0-70d3-b770-2d9e667117b1.jsonl`
- Cartelle immagini:
  `/Users/Matteo/.codex/generated_images/019e8e55-b6cb-77b0-852c-232f05d9eca2/`
  e
  `/Users/Matteo/.codex/generated_images/019e8ec8-ebb0-70d3-b770-2d9e667117b1/`
- Copia versionabile dei sei concept finali nella repo:
  `docs/assets/ui-concepts/2026-06-03/`

Nota di controllo finale: i due file JSONL sono in `archived_sessions`, perché
le chat risultano archiviate. La trascrizione in calce è stata confrontata
messaggio per messaggio con questi file archivio.

## Ultimi 6 concept da usare

Questi sono i sei concept finali da considerare reference operativo.

| Pagina       | Concept finale                                           | Motivo                                                                                                                            |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Panoramica   | `docs/assets/ui-concepts/2026-06-03/01-panoramica.png`   | Corretto dopo il pass che aveva introdotto export: niente export, prossima azione chiara, usa `Quantità da verificare`.           |
| Catalogo     | `docs/assets/ui-concepts/2026-06-03/02-catalogo.png`     | Rigenerato nel thread ponte: niente viola, niente frecce o segnali di sync catalogo bidirezionale.                                |
| Conflitti    | `docs/assets/ui-concepts/2026-06-03/03-conflitti.png`    | Mantiene le tre azioni decisionali corrette e diagnostica secondaria.                                                             |
| Importazione | `docs/assets/ui-concepts/2026-06-03/04-importazione.png` | Stepper e anteprima coerenti, default `Bozza`/`Attivo` e canali visibili come riepilogo.                                          |
| Attività     | `docs/assets/ui-concepts/2026-06-03/05-attivita.png`     | Timeline prima, diagnostica dopo. In implementazione rimuovere o ridimensionare eventuali azioni larghe tipo `Sincronizza tutto`. |
| Impostazioni | `docs/assets/ui-concepts/2026-06-03/06-impostazioni.png` | Rigenerato nel thread ponte: i quattro box sono uno sotto l'altro, non in una riga.                                               |

## Revisione post-publish 2026-06-05

Route production verificate dentro Shopify Admin:

| Pagina       | URL embedded          | Esito                                                                                                                                                                                              |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panoramica   | `/app`                | Struttura corretta, metriche reali e prossima azione visibile. La review aveva rilevato `Ricollega eBay` tra le azioni consigliate anche con account già collegato; corretto in `0.23.6`.          |
| Catalogo     | `/app/catalog`        | Table-first, thumbnail visibili, filtri separati, una sola colonna `Stato`, paginazione reale. Nessun export o segnale bidirezionale.                                                              |
| Conflitti    | `/app/conflicts`      | Default su conflitti aperti, azioni `Usa valore eBay`, `Mantieni Shopify`, `Ignora campo`, descrizioni leggibili e paginazione reale.                                                              |
| Importazione | `/app/import-preview` | Step progressivi, collegamento eBay nel punto corretto, default/canali riassunti, anteprima paginata e azione di import preservata.                                                                |
| Attività     | `/app/activity`       | Timeline e controlli rapidi presenti. La review aveva rilevato il filtro cliente `Audit` al posto di `Conflitti` e conflitti recenti non abbastanza visibili nella timeline; corretto in `0.23.6`. |
| Impostazioni | `/app/settings`       | Quattro box verticali confermati: `Sync catalogo`, `Import prodotti`, `Canali di vendita`, `Avanzate`. Nessun quinto box `Account`.                                                                |

Copertura dei cinque rilievi della review production precedente:

1. Catalogo conteggi/paginazione: production successiva ha mostrato totale
   reale, miniature prodotto e paginazione `1-100` / `101-200`; il codice usa
   conteggio reale e pagina server-side.
2. Conflitti KPI: i conteggi `Aperti`, `Risolti` e `Totale` sono calcolati con
   query dedicate, non più sul sottoinsieme caricato.
3. Importazione densità: la preview resta ricca, ma ora è paginata a 10 righe e
   separa filtri/step senza trasformarsi in un muro di 50 elementi.
4. Conflitti valori/hash: la pagina non espone hash descrizione come valori
   leggibili dal negoziante; le decisioni restano guidate dai campi e
   dall'impatto.
5. Attività e Impostazioni: entrambe caricano in produzione senza crash;
   `0.23.6` rimuove il filtro cliente `Audit`, promuove `Conflitti` nella
   timeline e Impostazioni conferma i quattro box verticali.

Confronto concept/implementazione:

- copy: nav e label primarie corrispondono alla IA confermata;
- layout: implementazione più Shopify-native dei mockup, con route reali invece
  di tavole statiche;
- densità: Catalogo e Conflitti restano compatti e revisionabili su dati reali;
- colore: palette SyncBay sobria, niente viola o gradienti inventati;
- anatomia: tabella per Catalogo, decision card per Conflitti, stepper per
  Importazione, timeline per Attività, form verticali per Impostazioni;
- dettagli tecnici: visibili solo come disclosure, controlli rapidi o sezioni
  avanzate, non come voce nav primaria.

Deviazioni intenzionali dai PNG:

- i mockup non sono pixel-perfect spec e mostrano dati fittizi; l'app usa dati
  reali dell'ambiente collegato durante quella verifica;
- il logo dei concept non è fonte di verità quando Image Gen lo reinterpreta;
- Panoramica può mostrare conflitti reali invece di uno stato `Tutto sotto
controllo`;
- Catalogo non implementa ricerca/salvataggio viste del concept, fuori dal
  perimetro MVP corrente;
- Conflitti non usa un pannello helper laterale permanente: le decisioni
  restano nella lista per ridurre complessità;
- Attività non espone `Sincronizza tutto`, perché è ambiguo rispetto al sync
  eBay -> Shopify e agli ordini Shopify -> eBay stock;
- Impostazioni mantiene i quattro box verticali senza creare `Account` come
  quinto box.

Nota di evidenza: il comando shell `screencapture` non ha prodotto immagini in
questo ambiente; la review visuale è stata condotta su Safari/Computer Use e
annotata qui. I sei PNG concept sono stati comunque riaperti con `view_image`
prima della chiusura.

## Riallineamento redesign 2026-06-12

Questo pass non sostituisce i concept del 2026-06-03: fissa lo stato effettivo
dopo il cleanup runtime e separa le superfici già ricontrollate da quelle fuori
scope.

| Superficie     | Stato                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Panoramica`   | Ricontrollata live come riferimento di coerenza. Nessuna modifica runtime nel cleanup `0.33.6`.                                                                                                                                            |
| `Catalogo`     | Riallineati badge accessorio, spaziatura filtri e fallback thumbnail senza immagine.                                                                                                                                                       |
| `Conflitti`    | Confermata IA con KPI `Aperti`, `Sicuri`, `Da rivedere`, `Da decidere`, `Totale`; fallback thumbnail coerente.                                                                                                                             |
| `Importazione` | Riallineati spaziatura filtri e copia primaria sullo scope `write_locations`.                                                                                                                                                              |
| `Attività`     | Diagnostica tecnica spostata dietro disclosure, filtri distanziati e timeline più leggibile.                                                                                                                                               |
| `Impostazioni` | Riallineata con quattro schede operative: `Sync catalogo`, `Import prodotti`, `Canali di vendita`, `Avanzate`. Sync e Avanzate restano a tutta larghezza; Import e Canali possono affiancarsi su desktop e collassano su viewport stretto. |

Il renderer locale di preview ora copre le sei superfici in scope con fixture
sintetiche sanificate. La verifica definitiva della resa `s-*` resta Shopify
Admin embedded.

### Matrice temi coperti

| Tema redesign                                          | Copertura                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Navigazione embedded e IA a sei voci                   | Tutte le pagine.                                                                                                        |
| Design layer con icone, tile e badge di stato          | Panoramica, Catalogo, Conflitti, Attività e Impostazioni; Importazione usa lo stepper dello stesso layer.               |
| Dettagli tecnici secondari, non dominanti              | Importazione, Attività e Impostazioni dietro disclosure; Catalogo e Conflitti restano focalizzate su tabella/decisioni. |
| Ritmo di spaziatura filtri e controlli                 | Catalogo, Conflitti, Importazione e Attività; Impostazioni usa form verticali distanziati dentro le schede.             |
| Responsive stretto                                     | Tile, timeline, stepper e schede Impostazioni collassano senza forzare larghezza extra.                                 |
| Sorgente eBay -> Shopify senza ambiguità bidirezionale | Tutte le pagine; Impostazioni ribadisce che solo gli ordini Shopify aggiornano la disponibilità eBay.                   |

## Readiness screenshot e microcopy 2026-06-05

Obiettivo: preparare l'app embedded per screenshot prodotto e review commerciale
senza introdurre schermate finte o dati di negozianti non autorizzati.

Sequenza consigliata screenshot:

1. `Panoramica`: prossima azione e stato sync visibili.
2. `Catalogo`: tabella con immagini, disponibilità e origine eBay chiara.
3. `Conflitti`: KPI `Sicuri`, `Da rivedere`, `Da decidere` e decision card.
4. `Attività`: timeline con impatto, prossima azione e retry sicuro.
5. `Importazione`: step progressivi e preview paginata.
6. `Impostazioni`: schede operative con sync, import, canali e avanzate.

Regole copy per screenshot:

- usare italiano operativo, frasi brevi e niente allarmismi;
- mostrare `Sicuri` solo per decisioni che non toccano prezzo,
  disponibilità, stato prodotto o mapping;
- mostrare `Attendi eBay` quando il retry manuale anticiperebbe un cooldown
  provider;
- preferire riferimenti tecnici sintetici come codici errore, non payload o
  token;
- non usare screenshot con dati personali, ordini reali, customer data,
  credenziali o listing di negozianti non autorizzati.

## Evoluzione 2026-06-08 - design layer e restyling

Revisione maintainer: la resa pubblicata è ancora percepita piatta rispetto ai
sei concept. Gerarchia debole, sezioni di peso uguale, vocabolario nativo
sotto-utilizzato (`s-icon` non usato). Aperto un lavoro di restyling con
priorità gerarchia/densità, poi coerenza/rifinitura, poi fedeltà ai concept.

Decisioni fissate (vedi ADR `docs/decisions/0010-ui-design-layer-e-marchi-terzi.md`):

- confine: resta "Shopify-native prima", con un design layer minimo a lista
  chiusa di tre elementi: tile metrica con `s-icon` e sfondo a tinta tenue,
  pannello connessioni con marchi eBay/Shopify, hero di stato con accento
  tonale;
- l'aside permanente "Come scegliere" nei Conflitti resta scartato;
- griglia condivisa: multi-regione responsiva, hero a tutta larghezza e fasce a
  due colonne che collassano a una su viewport stretto;
- marchi eBay/Shopify ufficiali ammessi come indicatori sobri, previa verifica
  delle brand guideline; fallback a indicatori neutri se non conformi;
- scope: presentazione, riordino e microcopy, con loader/selector ammessi se la
  UI lo richiede; quando si tocca un loader la verifica sale a corsia completa;
- esecuzione: sistema visivo condiviso + Panoramica come pagina-prova con
  approvazione del maintainer, poi propagazione alle altre cinque superfici.

## Evoluzione 2026-06-14 - Panoramica ridisegnata

Secondo giro di redesign richiesto dal maintainer: app più veloce, dinamica e
informativa, meno gergale. Lavorato sulla Panoramica come pagina-prova (route
reale `app/routes/app._index.tsx`), poi da propagare.

- design layer esteso (ADR 0010, estensione 2026-06-14): battito del sync,
  lente rischio disponibilità, sparkline affidabilità; il first-run riusa la
  tappa stepper per l'onboarding Collega → Importa → Attiva;
- contenuti: via i "Dettagli tecnici" dalla vista negoziante, azioni davvero
  contestuali, metriche con tendenza 24h e affidabilità 7 giorni dallo storico
  job (aggregazione in `getDashboardState`, nessun nuovo worker);
- linguaggio de-gergato (niente "Centro operativo"/"Pilota controllato"; azioni
  e stati specifici), attività come timeline;
- accento UI portato sul Bay Blue del logo, uso disciplinato, colori come
  variabili semantiche, tema chiaro theme-ready (ADR 0013);
- ancora aperto: propagazione alle altre cinque superfici, runtime vivo
  (streaming `defer`, polling leggero, toast) con ADR dati-live dedicato,
  conteggio "esaurite" nel battito;
- verifica: typecheck, lint, `test:lib` (221), build verdi; preview via
  `scripts/syncbay-ui-render.mjs panoramica --fixture`.

## Decisione prodotto

SyncBay resta una app Shopify embedded per negozianti italiani che partono da
un negozio eBay.it e vogliono mantenere un catalogo Shopify ordinato.

La direzione non cambia:

- sync catalogo principale: eBay verso Shopify;
- eBay resta la sorgente di verità del catalogo;
- Shopify riceve prodotti, prezzi, immagini, descrizioni e disponibilità;
- eccezione obbligatoria: ordine Shopify pagato verso aggiornamento stock eBay;
- niente export catalogo Shopify verso eBay nel MVP;
- niente promessa di sync catalogo bidirezionale;
- niente trasformazione in suite marketplace generalista.

Nei concept e in implementazione non devono comparire azioni o visual che
suggeriscano export o bidirezionalità catalogo, per esempio frecce in entrambe
le direzioni, `Esporta`, o `Sincronizza tutto` come azione ampia e ambigua.

## Architettura informativa

La home deve essere un centro operativo giornaliero, non un wizard permanente.

Nav finale confermata, in questo ordine:

1. `Panoramica`
2. `Catalogo`
3. `Conflitti`
4. `Importazione`
5. `Attività`
6. `Impostazioni`

Regole nav:

- `Diagnostica` non è una voce nav: vive dentro `Attività` o in pannelli
  avanzati.
- `Account` non è una voce nav: il collegamento eBay vive in `Importazione` e
  nelle impostazioni/avanzate.
- `Dashboard` non va usato: `Panoramica` è più naturale in italiano.
- La nav resta sotto 7 voci, con nomi brevi e sostantivi.

## Stack e componenti

Il repo usa app embedded Shopify con React Router, App Bridge e Polaris Web
Components Shopify (`s-page`, `s-section`, `s-box`, `s-stack`, `s-grid`,
`s-table`, `s-badge`, `s-button`, `s-select`, `s-switch`, `s-checkbox`,
`s-clickable-chip`, `s-thumbnail`, `s-image`, ecc.). La direzione decisa è:

- usare App Bridge e Polaris Web Components come base effettiva, non solo come
  ispirazione visiva;
- non introdurre Polaris React legacy solo per il redesign;
- usare componenti nativi per bottoni, form, sezioni, nav, badge, tabelle,
  pannelli/card, stati vuoti, stack/grid e miniature quando esiste una primitiva
  Shopify adatta;
- mantenere il 25% di identità SyncBay con asset reali, tagline, badge nativi
  nello slot accessorio delle pagine e microcopy ricorrente, non con una shell o
  palette custom sui componenti;
- aggiungere CSS custom leggero solo per identità minima SyncBay, shell/logo,
  dettagli tecnici o composizioni non coperte dai componenti Shopify; allo stato
  attuale della UI embedded l'eccezione custom residua è lo styling minimo dei
  disclosure tecnici nativi `details/summary`.

## Regole visual

Direzione visiva: 75% Shopify-native, 25% identità SyncBay.

Da usare:

- sfondo `Cloud` `#F6F8F7`;
- superfici `Paper` `#FFFFFF`;
- testo `Ink` `#15202B`;
- secondario `Slate` `#51615F`;
- bordi `Mist` `#D8E0DD`;
- azioni/accenti `Harbor` `#0F5E6E` e `Current` `#1A8F7A`;
- successo `Moss` `#3F7D4A`;
- warning `Amber` `#B7791F`;
- conflitto/errore `Coral` `#C75C48`;
- info `Steel` `#3D6F9F`;
- colori logo solo negli asset logo: `Bay Blue`, `Sync Green`,
  `Listing Yellow`, `Listing Red`.

Da evitare:

- viola o accenti inventati;
- gradienti dominanti;
- orbs, bokeh o decorazioni astratte;
- hero marketing;
- dashboard SaaS esterna allo stile Admin;
- claim o visual da app ufficiale eBay/Shopify.

Loghi eBay e Shopify sono consentiti come indicatori sobri di collegamento,
sorgente o destinazione. Non devono diventare co-branding dominante o claim di
ufficialità.

## Tono e copy

Lingua UI: italiano, professionale, concreto.

Regole:

- parlare al negoziante, non all'operatore tecnico;
- evitare `OAuth`, `scope`, `job`, `payload`, `mapping` nel livello primario;
- mostrare dettagli tecnici in disclosure o diagnostica secondaria;
- niente esclamativi, emoji, `oops` o messaggi vaghi;
- usare `Quantità da verificare`, non `Disponibilità non protetta`;
- usare `Aggiornamento catalogo in ritardo`, non label tecniche;
- usare `Mantieni Shopify`, `Usa valore eBay`, `Ignora campo` per i conflitti.

## Panoramica

Ruolo: centro operativo giornaliero.

Decisioni:

- deve aprire con la prossima azione o lo stato operativo, non con metriche nude;
- se tutto va bene, copy tipo `Tutto sotto controllo`;
- se serve intervento, dichiarare subito cosa richiede una scelta;
- i numeri sono supporto, non apertura principale;
- setup/importazione si vede solo quando manca un prerequisito reale o il flusso
  non è concluso;
- niente blocco onboarding permanente dopo il primo import.

Priorità della prossima azione:

1. `Collegamento eBay mancante o scaduto`
2. `Quantità da verificare`
3. `Conflitti aperti`
4. `Aggiornamento catalogo in ritardo`
5. `Importazione incompleta`
6. `Impostazioni mancanti`
7. `Tutto sotto controllo`

Sezioni previste:

- pannello stato/prossima azione;
- metriche compatte: prodotti collegati, conflitti aperti, quantità da
  verificare, ultimo aggiornamento;
- azioni consigliate;
- stato catalogo;
- collegamenti eBay/Shopify;
- attività recenti;
- diagnostica collassata.

## Catalogo

Ruolo: vista operativa dei prodotti Shopify collegati a eBay.

Non è:

- un editor prodotti completo;
- una copia di Shopify Products;
- un exporter;
- una pagina di importazione.

Decisioni:

- pagina table-first, con densità Shopify-native;
- prima colonna `Prodotto`, contenuto con thumbnail, titolo e SKU/ItemID
  secondario;
- un solo badge `Stato`, costruito da stato Shopify + stato SyncBay;
- `Stato Shopify` e `Stato SyncBay` non devono essere due colonne principali;
- dettagli tecnici nel drawer/dettaglio riga;
- `Archiviati` neutro, non viola;
- collegamento eBay testuale, senza frecce bidirezionali.

Filtri Catalogo:

- `Tutti`
- `Collegati`
- `Aggiornati`
- `Da controllare`
- `Conflitti`
- `Non aggiornati`
- `Archiviati`

Colonne:

- `Prodotto`
- `Collegamento`
- `Disponibilità`
- `Prezzo`
- `Aggiornamento`
- `Stato`
- `Azione`

Azioni riga:

- `Dettagli`
- `Risolvi`
- `Riprova`

## Importazione

Ruolo: flusso raro ma delicato per portare prodotti eBay in Shopify.

Decisioni:

- pagina unica a step progressivi;
- non più sottopagine separate;
- filtri di import restano in `Importazione`, non in `Catalogo`;
- la configurazione completa di default pubblicazione/canali vive in
  `Impostazioni`;
- `Importazione` mostra un riepilogo delle impostazioni e una scorciatoia per
  modificarle.

Step:

1. `Collegamento eBay`
2. `Preparazione Shopify`
3. `Anteprima catalogo`
4. `Importazione`
5. `Dopo l'import`

Filtri Importazione:

- `Tutti`
- `Pronti da importare`
- `Importazione in corso`
- `Già importati`
- `Da reimportare`
- `Errore`

Da preservare dal codice attuale:

- selezione location Shopify predefinita;
- rinomina location;
- default stato prodotti;
- modalità/nota immagini e descrizioni quando utile;
- dry-run e preview;
- esempi prodotto;
- validazioni e blocchi;
- avvio import controllato.

## Conflitti

Ruolo: workflow decisionale, non tabella tecnica.

Decisioni:

- default su conflitti aperti;
- storico risolti accessibile ma secondario;
- copy orientato a scelta e impatto;
- niente enum grezzi come `REALIGN_FROM_EBAY`, `KEEP_SHOPIFY`,
  `IGNORE_FIELD` nella UI primaria.

Filtri:

- `Aperti`
- `Risolti`
- `Tutti`

Struttura riga:

- `Prodotto`: thumbnail, titolo, riferimento eBay piccolo;
- `Campo`: prezzo, titolo, descrizione, disponibilità, stato;
- `Differenza`: valore Shopify e valore eBay;
- `Impatto`: cosa succede se non viene risolto;
- `Azione`: decisione esplicita.

Azioni:

- `Usa valore eBay`;
- `Mantieni Shopify`;
- `Ignora campo`.

## Attività

Ruolo: cronologia operativa leggibile con diagnostica secondaria.

Decisioni:

- assorbe attività recenti, job, audit, retry, errori e diagnostica;
- non deve sembrare un log tecnico;
- i dettagli tecnici esistono ma sono in disclosure o aside;
- diagnostica dentro la pagina, non nella nav;
- timeline prima, diagnostica dopo.

Filtri:

- `Tutte`
- `Importazioni`
- `Aggiornamenti`
- `Disponibilità`
- `Conflitti`
- `Errori`

Ogni evento deve mostrare:

- cosa è successo;
- quando;
- su quanti prodotti;
- esito;
- eventuale azione.

Esempi copy:

- `958 prodotti sincronizzati correttamente`;
- `12 prodotti messi in attesa per conflitto`;
- `Importazione completata`;
- `Quantità aggiornata dopo ordine Shopify`;
- `eBay non ha risposto, SyncBay riproverà automaticamente`.

Nota: il concept finale può mostrare un'azione larga tipo `Sincronizza tutto`.
In implementazione questa azione va rimossa o trasformata in comando molto
circoscritto, perché è ambigua rispetto allo scope eBay verso Shopify.

## Impostazioni

Ruolo: regole essenziali in alto, opzioni tecniche o rare in basso.

Decisioni:

- i quattro box del concept finale devono essere verticali, uno sotto l'altro,
  anche su desktop;
- non devono stare in una griglia a quattro colonne;
- default pubblicazione e canali sono impostazioni importanti e visibili;
- dettagli operatore restano negli avanzati.

Box del concept finale:

1. `Sync catalogo`
2. `Import prodotti`
3. `Canali di vendita`
4. `Avanzate` o `Collegamenti rapidi`

Da preservare dal codice attuale:

- attivazione/disattivazione sync catalogo automatico;
- prerequisiti/blocchi del sync;
- target sync;
- conteggio prodotti collegati;
- stato prodotti di default;
- policy pubblicazione canali: tutti, selezionati, nessuna pubblicazione
  automatica;
- lista canali Shopify selezionabili;
- collegamenti rapidi a Panoramica e Importazione.

Punto da non perdere: nelle decisioni precedenti `Account eBay` era previsto
come sezione tra `Importazione > Collegamento eBay` e
`Impostazioni > Account`/avanzate. Il concept finale a 4 box non lo mette in
primo piano. Prima dell'implementazione va deciso se:

- inserirlo nel quarto box `Avanzate`/`Collegamenti rapidi`, raccomandato per
  mantenere 4 box;
- oppure aggiungere un quinto box `Account`, rompendo però il vincolo visuale
  appena corretto.

Raccomandazione: mantenere i 4 box verticali e mettere account/ricollegamento
eBay dentro `Avanzate` come sottosezione, mentre il flusso primario di
collegamento resta in `Importazione`.

## Mappa dell'UI attuale

Il redesign non deve preservare tutto a ogni costo, ma non deve perdere nulla
senza decisione esplicita.

Regola confermata:

- promuovere ciò che serve ogni giorno;
- spostare ciò che serve raramente;
- nascondere negli avanzati ciò che è tecnico;
- rimuovere solo ciò che è duplicato, coperto meglio altrove o non serve più;
- documentare le rimozioni prima di implementare.

Mappa dalle superfici attuali:

- `Stato connessioni` -> `Panoramica`
- `Shopify`, scope, webhook -> `Attività > Diagnostica` e
  `Impostazioni > Avanzate`
- `eBay e privacy` -> `Importazione > Collegamento eBay` e impostazioni
  avanzate/account
- `Onboarding e preview` -> `Importazione`
- `Attività recenti`, `Diagnostica job`, `Audit` -> `Attività`
- `Import controllato` -> `Importazione`, con storico in `Attività`
- `Conflitti Shopify` -> `Conflitti`
- `Base tecnica`, `Scope Shopify` -> diagnostica/avanzate

Azioni da non perdere senza decisione:

- `Rimetti in coda`
- `Riallinea da eBay`, da rinominare `Usa valore eBay`
- `Mantieni Shopify`
- `Ignora campo`
- `Collega/Ricollega eBay`
- `Salva sync catalogo`
- `Salva stato prodotto default`
- `Salva canali`
- `Salva location`
- `Rinomina location`
- `Avvia importazione`

## Livelli utente

Decisione: due livelli impliciti, senza toggle visibile `modalità esperto`.

- `Negoziante`: vede stato, azioni, conflitti, catalogo, import e impostazioni
  principali.
- `Operatore/diagnostica`: vede dettagli tecnici in disclosure, aside o
  avanzate.

## Cose scartate

- PNG statici generati manualmente fuori da Image Gen come concept definitivi.
- `SyncBay Catalog Bridge` come nome app visibile. Il nome resta `SyncBay`;
  `Catalog Bridge` è direzione logo, non label prodotto.
- `Account` come voce nav primaria.
- `Diagnostica` come voce nav primaria.
- `Dashboard` come label primaria.
- Filtri import mescolati al catalogo.
- Due colonne principali separate per stato Shopify e stato SyncBay.
- Viola, gradienti e palette inventate.
- Frecce bidirezionali e azioni di export catalogo.

## Piano UI di implementazione

Il piano operativo completo vive in
`docs/superpowers/plans/2026-06-03-syncbay-ui-redesign.md`.

Il piano integra le decisioni dei due thread e della revisione successiva,
incluse:

- i concept sono reference direzionali, non specifiche pixel-perfect;
- prima del codice UI serve una Fase 0 documentale sui contratti dati;
- `Account eBay` non diventa una voce nav e non diventa un quinto box;
- il collegamento primario resta in `Importazione > Collegamento eBay`, mentre
  account/ricollegamento e dettagli tecnici stanno nel quarto box
  `Impostazioni > Avanzate`.

Tranche di implementazione:

0. contratti dati, solo documento/plan - chiusa;
1. helper UI, shell/nav e `Panoramica` - chiusa;
2. `Catalogo` e `Conflitti` - chiusa;
3. `Importazione` e `Impostazioni` - chiusa;
4. `Attività` - chiusa;
5. smoke check, browser QA e confronto visuale contro i sei concept in
   `docs/assets/ui-concepts/2026-06-03/` - review post-publish completata il
   2026-06-05; correzioni runtime e gate finali da pubblicare nello step
   successivo.

## Appendice - Fonti archiviate

La trascrizione integrale dei thread recuperati non vive più in questo documento
operativo: rendeva difficile distinguere decisioni vive, storico e istruzioni
obsolete copiate dalle chat.

Per audit o recupero puntuale usare le fonti indicate sopra:

- chat originale:
  `/Users/Matteo/.codex/archived_sessions/rollout-2026-06-03T18-34-02-019e8e55-b6cb-77b0-852c-232f05d9eca2.jsonl`;
- thread ponte:
  `/Users/Matteo/.codex/archived_sessions/rollout-2026-06-03T20-39-52-019e8ec8-ebb0-70d3-b770-2d9e667117b1.jsonl`;
- piano operativo versionato:
  `docs/superpowers/plans/2026-06-03-syncbay-ui-redesign.md`;
- concept finali versionati:
  `docs/assets/ui-concepts/2026-06-03/`.

Questo file resta la sintesi viva: concept finali, decisioni stabili, deviazioni
intenzionali e stato post-publish.
