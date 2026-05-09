# Versioning e procedura di release

Questa guida descrive come gestire il versioning di SyncBay.

Decisione di riferimento: `docs/decisions/0006-versioning-runtime-locale.md`.

## Pubblicare non è sempre rilasciare

In SyncBay ci sono due azioni diverse:

1. **Pubblicare**: portare una modifica su GitHub/main e verificarne i check pertinenti.
2. **Rilasciare**: creare una nuova versione SemVer dell'app aggiornando `app/lib/version.ts` e chiudendo il blocco versionato del changelog.

Piani, ADR, guide interne, regole agenti e documentazione non esposta nell'app possono essere pubblicati nel repo senza rilasciare una nuova versione. In quel caso non modificare `APP_VERSION` e usa `### Non versionato` nel changelog se serve tenere traccia del lavoro.

## Single source of truth

- `app/lib/version.ts` esporta `APP_VERSION` e `BUILD_DATE`.
- La dashboard embedded importa `APP_VERSION` da quel file.
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
3. se contiene `### Novità`, `### Correzioni`, `### Sotto il cofano` o `### Rimosso`, esegui `npm run release` oppure dichiara esplicitamente che la release resta il prossimo passo operativo;
4. verifica il diff generato prima di commit/push;
5. non creare tag, GitHub Release o Release Please fuori da una decisione esplicita.

## Rapporto con deploy

Il versioning locale non crea deploy, tag o GitHub Release.

Quando il deploy production sarà attivo, una pubblicazione completa dovrà distinguere:

- merge su `main`;
- deploy Vercel completato;
- verifica smoke della dashboard embedded;
- eventuale release SemVer;
- cleanup branch.

Fino ad allora, una release SyncBay aggiorna repo e changelog, ma non implica pubblicazione Shopify App Store, billing o integrazioni produttive.
