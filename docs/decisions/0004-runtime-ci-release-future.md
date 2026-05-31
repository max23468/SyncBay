# ADR 0004 - Runtime, CI e release dopo lo scaffold

- **Stato**: Accettato come policy futura
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay ora ha scaffold applicativo, `package.json`, build e runtime di base. Questo ADR resta valido per CI e deploy production; la parte versioning locale è stata attivata con ADR 0006.

## Decisione

Manteniamo la policy prudente per CI, deploy e automazioni remote. Il versioning locale è attivo; workflow runtime e automazioni remote di release restano non attivati.

## Runtime

Lo scaffold deve restare coerente con ADR 0001:

- Shopify CLI;
- template React Router ufficiale Shopify disponibile al momento dello scaffold;
- TypeScript/Node;
- Shopify Admin GraphQL;
- Supabase Postgres;
- Prisma;
- Supabase Queues;
- Supabase Cron;
- Vercel;
- Supabase Storage per staging immagini temporaneo quando serve.

Le decisioni tecniche bloccanti sono chiuse da ADR 0005. Restano da completare:

- definizione degli URL reali;
- inserimento dei secret nei provider, non nel repo;
- verifica del keyset eBay quando eBay lo approva.

## CI futura

Quando la CI verrà attivata, la CI dovrà essere introdotta con un workflow dedicato e comandi reali nel repo.

Gate minimi attesi:

- installazione deterministica dipendenze;
- typecheck;
- lint;
- test;
- build;
- format/check;
- audit dipendenze quando cambiano manifest o lockfile;
- check mirati per eventuali migration/schema.

Il workflow Quality di Pratix e il modello di CI prudente di DocMolder sono riferimenti, ma SyncBay non deve copiarli alla cieca: i comandi devono nascere dallo scaffold effettivo.

Non creare un workflow CI fittizio che passa senza validare prodotto reale.

## Dependabot

Dependabot è attivo per GitHub Actions.

Poiché lo scaffold esiste, mantenere anche l'ecosistema package coerente col package manager scelto. Se lo stack resta npm, il blocco sarà `package-ecosystem: npm` su directory `/`, con PR settimanali e minor/patch raggruppate.

## Release locale e release futura

Il versioning locale è definito in ADR 0006 e usa `app/lib/version.ts` + `npm run release`.

Tag GitHub e GitHub Release sono definiti in ADR 0008 e restano manuali,
obbligatori per release prodotto reali. Restano non attivi Release Please e
release collegate automaticamente a deploy production.

Se verrà introdotta una release collegata a deploy production, dovrà definire:

- single source of truth della versione;
- se usare script locale, Release Please o altro flusso;
- chi aggiorna `CHANGELOG.md`;
- come vengono create GitHub Release;
- rapporto tra release, deploy e Shopify App Store;
- smoke test post-deploy;
- rollback.

Default concettuale:

- `MAJOR` per breaking change visibili o contratti tecnici incompatibili;
- `MINOR` per nuove funzionalità compatibili;
- `PATCH` per fix, hardening e miglioramenti compatibili;
- `Non versionato` per piani, ADR, guide interne e regole di processo.

## Release Please

Release Please non viene attivato ora.

Potrà essere valutato dopo lo scaffold se:

- il progetto ha commit Conventional Commit affidabili;
- esiste un file versione o manifest gestito;
- esistono test/build sufficienti;
- il maintainer preferisce Release PR automatica rispetto a uno script locale.

Se adottato, andrà documentato con ADR o aggiornamento di questa decisione, e dovranno essere definiti i file release-owned da non toccare nelle PR normali.

## Deploy futuro

Esiste un deployment pilota Vercel production, ma non equivale a production
stabile Shopify App Store, billing o release pubblica. Il provider runtime MVP
resta quello deciso in ADR 0005.

Quando verrà promossa una production stabile oltre il pilota, servirà aggiornare
le guide operative con:

- ambienti preview/staging/production;
- segreti e variabili ambiente;
- webhook Shopify/eBay e callback OAuth;
- rapporto tra merge su `main`, deploy automatico e release versionata;
- verifiche smoke;
- rollback.

## Conseguenze

- SyncBay è pronto a introdurre CI/deploy senza improvvisare.
- Le automazioni GitHub già attive restano limitate a gestione PR/commenti e aggiornamenti Actions.
- Non esistono workflow runtime falsi o comandi placeholder che potrebbero dare sicurezza artificiale.

## Alternative considerate

- **Copiare subito la Quality CI di Pratix**: scartato, perché i comandi SyncBay devono nascere dal runtime effettivo.
- **Attivare subito Release Please come DocMolder**: scartato, perché SyncBay usa per ora release locale senza tag/GitHub Release.
- **Creare script release locale stile FiscalBay**: sostituito da script locale in stile Pratix con ADR 0006.

## Riferimenti

- `docs/decisions/0001-stack.md`
- `docs/decisions/0003-git-pubblicazione-versioning.md`
- `docs/decisions/0005-runtime-infrastructure.md`
- `docs/guides/versioning-e-release.md`
- `docs/guides/git-e-pubblicazione.md`
