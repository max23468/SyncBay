# Versioning e procedura di release

Questa guida descrive come gestire il versioning di SyncBay.

Decisioni di riferimento:

- `docs/decisions/0006-versioning-runtime-locale.md`
- `docs/decisions/0008-tag-e-github-release.md`

## Pubblicare e rilasciare

In SyncBay pubblicazione e release locale devono procedere insieme quando una modifica è versionata:

1. **Pubblicare**: portare una modifica su GitHub/main con PR/merge (o commit diretto
   documentato), verificarne i check pertinenti, completare il cleanup branch/worktree
   assorbito e includere la release locale quando serve.
2. **Rilasciare**: creare una nuova versione SemVer dell'app aggiornando `app/lib/version.ts`, chiudendo il blocco versionato del changelog e pubblicando quella modifica su GitHub/main.

Piani, ADR, guide interne, regole agenti e documentazione non esposta nell'app possono essere pubblicati nel repo senza bump SemVer. In quel caso non modificare `APP_VERSION` e usa `### Non versionato` nel changelog se serve tenere traccia del lavoro.

Regola operativa: se il blocco `[Non rilasciato]` di `CHANGELOG.md` contiene sezioni versionate (`Novità`, `Correzioni`, `Sotto il cofano`, `Rimosso`), una richiesta di `pubblica` o `rilascia` deve includere `npm run release` prima di commit/push o prima della PR finale.

## Single source of truth

- `app/lib/version.ts` esporta `APP_VERSION` e `BUILD_DATE`.
- La dashboard embedded importa `APP_VERSION` e `BUILD_DATE` da quel file.
- Non hardcodare la versione in UI, README o documenti operativi.

## Comandi

```bash
npm run release
npm run release:dry-run
npm run release -- --bump patch
npm run release -- --bump minor
npm run release -- --bump major
npm run release -- --bump none
```

Il comando:

- legge `CHANGELOG.md`;
- rifiuta il rilascio se `## [Non rilasciato]` è vuoto;
- inferisce il bump se non viene passato esplicitamente;
- distingue `### Non versionato`, che non genera una nuova versione;
- blocca il rilascio se il changelog mescola voci versionate e non versionate;
- aggiorna `CHANGELOG.md` e `app/lib/version.ts`.

## Quando bumpare

### MAJOR

Cambiamento non retrocompatibile per negoziante, dati o contratti tecnici documentati.

Esempi:

- cambio incompatibile alle env var richieste;
- migration distruttiva o non reversibile;
- rimozione o rinomina di un flusso dashboard già pubblicato;
- cambio incompatibile nel comportamento di import/sync.

### MINOR

Nuova funzionalità retrocompatibile.

Esempi:

- nuova vista dashboard;
- nuovo step opzionale di onboarding;
- nuova regola prezzo Shopify-only;
- nuova azione guidata di diagnostica.

### PATCH

Correzione o miglioramento compatibile.

Esempi:

- fix OAuth Shopify/eBay;
- fix retry o rate limit;
- miglioramento copy/UI senza nuovo flusso;
- hardening sicurezza compatibile;
- miglioramento operativo di deploy o sync.

### Nessuna release

Nessun bump quando il cambiamento non modifica runtime, UI, contenuti pubblici, dati, deploy o supporto a una versione.

Esempi:

- aggiornamento di `AGENTS.md`;
- ADR o piano interno;
- guida operativa;
- issue/PR template;
- nota di roadmap senza codice eseguito.

## Changelog

Il blocco `## [Non rilasciato]` deve usare solo sezioni riconosciute:

- `### Novità`
- `### Correzioni`
- `### Sotto il cofano`
- `### Rimosso`
- `### Non versionato`

Non mescolare `### Non versionato` con sezioni versionate nello stesso rilascio. Se serve pubblicare documentazione interna e runtime insieme, separa i lavori o rilascia solo il blocco versionato dopo aver spostato le note interne.

## Gate di chiusura

Prima di dichiarare conclusa una fase, pubblicazione o release:

1. controlla `CHANGELOG.md`;
2. se contiene solo `### Non versionato`, non eseguire release SemVer;
3. se contiene `### Novità`, `### Correzioni`, `### Sotto il cofano` o `### Rimosso`, esegui `npm run release` e includi `CHANGELOG.md` e `app/lib/version.ts` nel commit di pubblicazione;
4. verifica il diff generato prima di commit/push;
5. creare tag Git `vX.Y.Z` e GitHub Release per ogni release prodotto reale secondo ADR 0008;
6. non creare Release Please fuori da una decisione esplicita.

## Rapporto con deploy

Il versioning locale non crea deploy.

Tag Git `vX.Y.Z` e GitHub Release sono obbligatori per release prodotto reali secondo ADR
0008.

Con il deployment pilota Vercel attivo, una pubblicazione completa deve includere:

- merge su `main`;
- release SemVer quando il blocco `[Non rilasciato]` del changelog contiene sezioni versionate;
- deploy Vercel completato;
- verifica smoke della dashboard embedded;
- tag Git `vX.Y.Z` e GitHub Release se la release è prodotto reale;
- cleanup branch.

Anche con deploy pilota attivo, una release SyncBay aggiorna repo e changelog,
ma non implica pubblicazione Shopify App Store, billing o integrazioni
produttive.

## Tag e GitHub Release

Per una release prodotto reale:

- `app/lib/version.ts`, aggiornato da `npm run release`, resta la source of
  truth;
- il tag Git deve avere formato `vX.Y.Z` e corrispondere esattamente a
  `APP_VERSION`;
- la GitHub Release deve essere creata da quel tag e usare note derivate dalla
  sezione rilasciata di `CHANGELOG.md`;
- il deploy Vercel resta separato e non implica App Store, billing o
  integrazioni produttive.

Non creare tag o GitHub Release per `### Non versionato`, piani, ADR, guide,
governance, template o pubblicazioni docs-only.
