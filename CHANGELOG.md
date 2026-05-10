# Changelog

Tutte le modifiche significative a SyncBay sono documentate in questo file.

Il formato segue Keep a Changelog e il versionamento segue Semantic Versioning adattato a Shopify app SaaS.

## [Non rilasciato]

### Sotto il cofano

- Applicate su Supabase le migration remote per primitive runtime e mapping/snapshot/conflitti, mantenendo disabilitato l'import Shopify draft.
- Rilasciata la configurazione Shopify app `syncbay-2` con URL Vercel e rimossa l'opzione CLI non più supportata `include_config_on_deploy`.
- Evitato il falso blocco readiness quando Shopify restituisce scope `write_*` che coprono anche la lettura richiesta dalla diagnostica.
- Preparata l'azione controllata per creare bozze Shopify da preview mock, ancora bloccata dal feature flag `SYNCBAY_DRAFT_IMPORT_ENABLED`.
- Aggiunto `write_locations` agli scope Shopify pilota per consentire future modifiche controllate alle location.

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
