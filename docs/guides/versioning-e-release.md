# Guida versioning e release

SyncBay non ha ancora runtime, deploy o release versionate.

Questa guida definisce la policy provvisoria e cosa aggiornare quando il progetto passera a implementazione.

Decisione di riferimento: `docs/decisions/0003-git-pubblicazione-versioning.md`.

## Stato corrente

- Documentazione e fondazioni repo: nessuna versione applicativa.
- `CHANGELOG.md` traccia modifiche significative.
- Non esiste deploy.
- Non esiste pubblicazione Shopify App Store.

## Commit

Usare Conventional Commit:

- `docs:` documentazione;
- `feat:` nuova funzionalita osservabile;
- `fix:` correzione osservabile;
- `perf:` miglioramento prestazionale osservabile;
- `chore:` manutenzione interna;
- `refactor:` ristrutturazione senza cambio comportamento;
- `test:` test;
- `ci:` workflow/CI.

Il tipo commit deve anticipare l'impatto release futuro:

- `feat:` -> candidato `MINOR`;
- `fix:` o `perf:` -> candidato `PATCH`;
- `feat!:`, `fix!:` o footer `BREAKING CHANGE:` -> candidato `MAJOR`;
- `docs:`, `test:`, `chore:`, `ci:`, `refactor:` senza impatto runtime -> nessuna release.

Se un cambiamento e osservabile da negoziante o operatore, non nasconderlo dietro `chore:` o `refactor:`.

## Changelog

Durante la fase documentale, usare:

- `## [Non rilasciato]`
- `### Non versionato`

Usa `Non versionato` per:

- piani, ADR e guide operative;
- regole agenti e policy di processo;
- documentazione interna non esposta al prodotto;
- asset o materiali di fondazione senza runtime;
- configurazioni GitHub che non cambiano un'app pubblicata.

Quando esistera runtime:

- `Novita` per nuove funzionalita negoziante;
- `Correzioni` per bugfix;
- `Sotto il cofano` per refactor, hardening, infra;
- `Non versionato` per piani, ADR, guide e regole interne.

Non mescolare nello stesso rilascio futuro voci versionate e voci `Non versionato` se l'automazione scelta non lo supporta: separa la pubblicazione documentale dalla release runtime.

## Classificazione SemVer futura

Quando esistera codice applicativo, ogni modifica dovra essere classificata prima di chiudere il lavoro.

### MAJOR

Breaking change per negoziante, operatore o contratti tecnici documentati.

Esempi futuri:

- cambio incompatibile alle env var richieste;
- cambio distruttivo a schema o dati senza migrazione trasparente;
- rimozione o rinomina di un flusso dashboard gia pubblicato;
- cambio incompatibile nel comportamento di import/sync.

### MINOR

Nuova funzionalita compatibile.

Esempi futuri:

- nuova vista dashboard;
- nuovo step opzionale di onboarding;
- nuova regola prezzo Shopify-only;
- nuova azione guidata di diagnostica.

### PATCH

Correzione o miglioramento compatibile.

Esempi futuri:

- fix OAuth Shopify/eBay;
- fix retry o rate limit;
- miglioramento copy/UI senza nuovo flusso;
- hardening sicurezza compatibile;
- miglioramento operativo di deploy o sync.

### Nessuna release

Nessun bump SemVer quando il cambiamento non modifica runtime, UI, contenuti pubblici, dati, deploy o supporto a una versione.

Esempi:

- aggiornamento di `AGENTS.md`;
- ADR o piano pre-scaffold;
- guida interna;
- issue/PR template;
- nota di roadmap senza codice.

## Gate di chiusura

Prima di dichiarare conclusa una fase, pubblicazione o release:

1. controlla `CHANGELOG.md`;
2. se contiene solo `### Non versionato`, pubblica su GitHub senza bump;
3. se in futuro contiene `### Novita`, `### Correzioni` o `### Sotto il cofano`, non chiudere senza release oppure senza indicare il rilascio come prossimo step operativo;
4. non creare tag, GitHub Release o bump manuali fuori dal flusso ufficiale deciso.

## Release future

Prima di introdurre release versionate servono:

- ADR release/versioning;
- comando di build/test;
- target deploy;
- policy Shopify custom/pubblica;
- criterio SemVer;
- procedura rollback.

La scelta tra script locale, Release Please o altro strumento resta aperta fino allo scaffold. Quando sara decisa, dovra indicare:

- file single source of truth della versione;
- formato tag GitHub;
- chi aggiorna `CHANGELOG.md`;
- come vengono create eventuali GitHub Release;
- quali check bloccano release e deploy;
- come si verifica una pubblicazione completa.
