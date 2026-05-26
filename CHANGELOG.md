# Changelog

Tutte le modifiche significative a SyncBay sono documentate in questo file.

Il formato segue Keep a Changelog e il versionamento segue Semantic Versioning adattato a Shopify app SaaS.

## [Non rilasciato]

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
