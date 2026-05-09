# Guida versioning e release

SyncBay non ha ancora runtime, deploy o release versionate.

Questa guida definisce la policy provvisoria e cosa aggiornare quando il progetto passera a implementazione.

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
- `chore:` manutenzione interna;
- `refactor:` ristrutturazione senza cambio comportamento;
- `test:` test;
- `ci:` workflow/CI.

## Changelog

Durante la fase documentale, usare:

- `## [Non rilasciato]`
- `### Non versionato`

Quando esistera runtime:

- `Novita` per nuove funzionalita negoziante;
- `Correzioni` per bugfix;
- `Sotto il cofano` per refactor, hardening, infra;
- `Non versionato` per piani, ADR, guide e regole interne.

## Release future

Prima di introdurre release versionate servono:

- ADR release/versioning;
- comando di build/test;
- target deploy;
- policy Shopify custom/pubblica;
- criterio SemVer;
- procedura rollback.

