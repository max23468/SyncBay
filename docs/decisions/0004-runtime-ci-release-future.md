# ADR 0004 - Runtime, CI e release dopo lo scaffold

- **Stato**: Accettato come policy futura
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay non ha ancora scaffold applicativo, `package.json`, test, build, runtime o deploy. Il repository pero deve gia avere una direzione chiara per evitare che CI, release e deploy vengano introdotti in modo incoerente quando partira lo sviluppo.

## Decisione

Definiamo ora la policy teorica per runtime, CI e release, ma non attiviamo workflow runtime o automazioni di release finche non esistono scaffold e comandi reali.

## Runtime futuro

Lo scaffold dovra restare coerente con ADR 0001:

- Shopify CLI;
- template React Router ufficiale Shopify disponibile al momento dello scaffold;
- TypeScript/Node;
- Shopify Admin GraphQL;
- PostgreSQL;
- job queue persistente;
- deploy da decidere con ADR dedicato prima di qualunque ambiente production.

Prima dello scaffold vanno chiusi almeno:

- hosting/app URL;
- database e provider PostgreSQL;
- ORM;
- job queue;
- storage temporaneo immagini;
- strategia segreti/cifratura;
- strategia webhook pubblici locali.

## CI futura

Quando esistera `package.json`, la CI dovra essere introdotta con un workflow dedicato e comandi reali nel repo.

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

Finche non esiste runtime, non creare un workflow CI fittizio che passa senza validare prodotto reale.

## Dependabot

Dependabot e attivo per GitHub Actions.

Quando esistera lo scaffold, aggiungere anche l'ecosistema package coerente col package manager scelto. Se lo stack resta npm, il blocco sara `package-ecosystem: npm` su directory `/`, con PR settimanali e minor/patch raggruppate.

## Release futura

La release runtime resta non attiva finche non esiste una app.

Quando verra attivata, dovra definire:

- single source of truth della versione;
- formato tag GitHub;
- se usare script locale, Release Please o altro flusso;
- chi aggiorna `CHANGELOG.md`;
- come vengono create GitHub Release;
- rapporto tra release, deploy e Shopify App Store;
- smoke test post-deploy;
- rollback.

Default concettuale:

- `MAJOR` per breaking change visibili o contratti tecnici incompatibili;
- `MINOR` per nuove funzionalita compatibili;
- `PATCH` per fix, hardening e miglioramenti compatibili;
- `Non versionato` per piani, ADR, guide interne e regole di processo.

## Release Please

Release Please non viene attivato ora.

Potra essere valutato dopo lo scaffold se:

- il progetto ha commit Conventional Commit affidabili;
- esiste un file versione o manifest gestito;
- esistono test/build sufficienti;
- il maintainer preferisce Release PR automatica rispetto a uno script locale.

Se adottato, andra documentato con ADR o aggiornamento di questa decisione, e dovranno essere definiti i file release-owned da non toccare nelle PR normali.

## Deploy futuro

Non esiste deploy runtime oggi.

Quando verra scelto, serve ADR dedicato che chiarisca:

- provider;
- ambienti preview/staging/production;
- segreti e variabili ambiente;
- webhook Shopify/eBay e callback OAuth;
- rapporto tra merge su `main`, deploy automatico e release versionata;
- verifiche smoke;
- rollback.

## Conseguenze

- SyncBay e pronto a introdurre CI/release senza improvvisare.
- Le automazioni GitHub gia attive restano limitate a gestione PR/commenti e aggiornamenti Actions.
- Non esistono workflow runtime falsi o comandi placeholder che potrebbero dare sicurezza artificiale.

## Alternative considerate

- **Copiare subito la Quality CI di Pratix**: scartato, perche richiede npm, build, test e lint che SyncBay non ha ancora.
- **Attivare subito Release Please come DocMolder**: scartato, perche non esistono package, runtime o file versione.
- **Creare script release locale stile FiscalBay**: scartato, perche non esiste deploy/runtime da rilasciare.

## Riferimenti

- `docs/decisions/0001-stack.md`
- `docs/decisions/0003-git-pubblicazione-versioning.md`
- `docs/guides/versioning-e-release.md`
- `docs/guides/git-e-pubblicazione.md`
