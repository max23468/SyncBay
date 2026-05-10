# Changelog

Tutte le modifiche significative a SyncBay sono documentate in questo file.

Il formato segue Keep a Changelog e il versionamento segue Semantic Versioning adattato a Shopify app SaaS.

## [Non rilasciato]

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
[0.1.3]: #013--2026-05-10
[0.1.2]: #012--2026-05-10
[0.1.1]: #011--2026-05-10
[0.1.0]: #010--2026-05-10
