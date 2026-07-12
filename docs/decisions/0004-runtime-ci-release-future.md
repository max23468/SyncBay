# ADR 0004 - Runtime, CI e release dopo lo scaffold

- **Stato**: Accettato
- **Data**: 2026-05-09
- **Aggiornato**: 2026-07-12
- **Decisori**: maintainer, Codex

## Contesto

SyncBay ora ha scaffold applicativo, `package.json`, build e runtime di base. Questo ADR resta valido per CI e deploy production; la parte versioning locale è stata attivata con ADR 0006.

## Decisione

Manteniamo la policy prudente per automazioni remote di release. Il versioning
locale è attivo. La CI runtime completa è stata attivata il 2026-06-27 e
consolidata il 2026-07-12 in un gate PR proporzionato. Vercel resta collegato
al repository, ma salta build privi di impatto sul runtime; le automazioni
remote di release restano non attive.

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

Le decisioni tecniche bloccanti sono chiuse da ADR 0005. Per il pilota runtime
sono già stati configurati URL reali, secret nei provider e keyset eBay
dedicato; resta da definire una policy production stabile oltre il pilota.

## CI corrente

La CI runtime completa è stata attivata il 2026-06-27 con il workflow
`.github/workflows/ci.yml`, un job unico `verify` su `pull_request` verso
`main` e `workflow_dispatch`. Il ruleset di `main` richiede PR, risoluzione
delle conversazioni, `Verifica proporzionata` e `Conventional PR title`, senza
approval o policy strict/up-to-date. Il secondo check è minimale e separato per
rivalidare title edit e nuovi SHA senza poter sostituire il gate runtime. Il run
duplicato dopo il merge è stato rimosso perché il ruleset impedisce il normale
push diretto a `main`.

Il job runtime sceglie una sola corsia:

- diff docs/governance: `git diff --check`;
- diff runtime/tooling: `npm ci` e `verify:full -- --no-receipt`.

La corsia completa esegue in serie:

- installazione deterministica dipendenze (`npm ci`);
- generazione Prisma una sola volta;
- lint (`npm run lint`);
- test tooling (`npm run test:tooling`);
- typecheck raw dopo la generazione Prisma;
- coverage librerie pure (`npm run coverage:lib`);
- test servizi raw;
- build raw;
- validazione schema Prisma (`npm run prisma:validate`);
- smoke UI (`npm run smoke:ui`);
- audit dipendenze di produzione (`npm run audit:prod`, wrapper di
  `npm audit --omit=dev` con eccezione mirata per la vulnerabilità moderata
  nota di Prisma 7).

Esclusioni consapevoli:

- `format/check`: prettier non è ancora configurato nel repo; introdurlo è una
  decisione separata e va fatto solo dopo un primo allineamento di formato per
  non aprire un gate sistematicamente rosso;
- `db:verify` e `db:push:dry-run`: girano con `--linked` contro il Supabase
  remoto reale, quindi validano lo stato del DB live e non la PR, richiedono
  secret e non sono deterministici; restano controlli locali o, in futuro, un
  workflow schedulato dedicato, non un gate per-PR;
- applicazione delle migration (`prisma migrate deploy` in CI): valutata e
  scartata per ora. Le migration SyncBay sono Supabase-native (`pgmq`,
  `pg_cron`, `pg_net`, schema `storage`, ruoli `anon`/`authenticated`/
  `service_role`, `cron.job`) e fallirebbero su un Postgres vanilla effimero.
  Un gate corretto richiederebbe l'intero stack `supabase start` in CI: resta
  un follow-up possibile, da introdurre solo dopo verifica verde dedicata. In
  CI lo schema è comunque coperto da `prisma:validate`;
- qualità React: resta nel workflow dedicato `react-doctor.yml`, usa sempre
  `react-doctor@latest` sui file PR pertinenti e mantiene il full scan manuale;
- Supabase Preview: l'integrazione GitHub Supabase è disattivata perché le
  migration canoniche vivono in `prisma/migrations`, non in
  `supabase/migrations`, quindi il check non validava il flusso reale;
- Vercel, React Doctor, Doppler e CodeQL restano advisory o path-scoped e non
  sono status richiesti dal ruleset.

Il workflow precedente `pr-quality.yml` (solo `test:lib` + `coverage:lib`) è
stato rimosso perché interamente sussunto da `ci.yml`.

Il workflow Quality di Pratix e il modello di CI prudente di DocMolder sono
riferimenti, ma SyncBay non li ha copiati alla cieca: i comandi nascono dallo
scaffold effettivo.

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

## Deploy Vercel

Esiste un deployment Vercel production per la distribuzione privata, ma non
equivale a Shopify App Store, billing o release pubblica. Il provider runtime
MVP resta quello deciso in ADR 0005.

L'integrazione Git crea Preview e Production deployment soltanto quando il diff
tocca superfici distribuibili. `scripts/syncbay-vercel-ignore-build.mjs` salta
docs, governance, CI, test e tooling non runtime; file sconosciuti mantengono
il fallback conservativo al build.

Quando verrà promossa una production stabile oltre il pilota, servirà aggiornare
le guide operative con:

- ambienti preview/staging/production;
- segreti e variabili ambiente;
- webhook Shopify/eBay e callback OAuth;
- rapporto tra merge su `main`, deploy automatico e release versionata;
- verifiche smoke;
- rollback.

## Conseguenze

- Ogni merge ordinario passa dalla CI canonica senza duplicare il gate dopo il
  merge.
- Check specialistici e provider non bloccano PR fuori dal proprio perimetro.
- Vercel non ricostruisce il runtime per modifiche solo documentali o di
  governance.
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
