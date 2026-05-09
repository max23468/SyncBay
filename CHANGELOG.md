# Changelog

Tutte le modifiche significative a SyncBay saranno documentate in questo file.

Il formato segue Keep a Changelog e il versionamento seguira Semantic Versioning quando il runtime applicativo esistera.

## [Non rilasciato]

### Non versionato

- Avviata la documentazione di fondazione: piano prodotto/tecnico, benchmark competitivo, ADR stack, roadmap, AGENTS, README e struttura docs.
- Aggiunte decisioni aperte, checklist pre-scaffold, governance servizio, guida Git/pubblicazione e security policy.
- Definito il branding iniziale SyncBay con `BRAND.md` e ADR dedicato.
- Consolidato il logo definitivo Catalog Bridge con asset SVG, PNG, favicon, combinati e manifest in `brand/assets/`.
- Creato il repository GitHub privato `max23468/SyncBay` e documentato il remote iniziale.
- Aggiunti issue template, PR template e configurazione GitHub iniziale in linea con le repo operative esistenti.
- Formalizzata la policy di pubblicazione GitHub, PR, commit, changelog e versioning futuro con ADR dedicato.
- Configurati Dependabot per GitHub Actions e workflow `Codex PR comments`, e definita la policy futura per runtime, CI e release.
- Definiti i prerequisiti account Shopify/eBay, gli scope MVP, i webhook minimi e le env var previste prima dello scaffold.
- Collegata Shopify CLI all'app `SyncBay` e configurato il development store `syncbay-dev.myshopify.com`.
- Allineato lo stato dei prerequisiti eBay: account Developer confermato e keyset/app SyncBay richiesto a eBay.
- Chiuse le decisioni tecniche bloccanti con ADR infrastruttura runtime MVP: Vercel + Supabase, Prisma, Supabase Queues/Cron e storage temporaneo immagini.
- Creati e collegati i progetti runtime minimi Vercel `syncbay` e Supabase `mgjcbuokppfnglsftsmi`, senza deploy o schema applicativo.
- Creato lo scaffold Shopify CLI React Router TypeScript con Prisma session storage, dashboard embedded minima e webhook base.
