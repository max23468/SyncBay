# Guida Git e pubblicazione

Questa guida definisce la policy provvisoria Git/PR per SyncBay. Va aggiornata quando il repo avra un remote GitHub.

## Stato corrente

- Repo Git locale inizializzata.
- Remote GitHub non ancora documentato.
- Nessun deploy.
- Nessuna release runtime.
- Nessuna CI definita.

## Regola base

Prima di ogni modifica:

```bash
git status --short
```

Non sovrascrivere modifiche non tue. Se il worktree e sporco per un filone diverso, separare il lavoro prima di modificare file sovrapposti.

## Commit

Usare Conventional Commit:

- `docs:` documentazione;
- `feat:` funzionalita osservabile;
- `fix:` correzione osservabile;
- `chore:` manutenzione;
- `refactor:` refactor senza cambio comportamento;
- `test:` test;
- `ci:` CI/workflow.

Durante la fase docs-only, il commit naturale sara `docs: bootstrap SyncBay planning`.

## Branch e PR dopo collegamento GitHub

Quando esistera un remote:

- usare branch dedicati per lavori non banali: `codex/<tema>`;
- aprire PR verso `main`;
- tenere PR piccole e reviewable;
- includere sintesi, file toccati, rischi, verifiche e prossimi passi;
- eliminare branch locali/remoti quando il lavoro e mergeato e assorbito;
- non introdurre deploy/release impliciti con la sola parola "pubblica".

## Docs-only

Per modifiche puramente documentali:

- `git diff --check` e review del contenuto sono sufficienti;
- non inventare test applicativi;
- aggiornare `CHANGELOG.md` sotto `Non versionato` quando la modifica e significativa.

## Pubblica, deploya, rilascia

Finche SyncBay non ha runtime:

- "pubblica" puo significare commit/push/PR docs quando esiste un remote;
- "deploya" non ha effetto operativo finche non esiste deploy;
- "rilascia" richiede prima una policy release/versioning.

Quando questi flussi verranno decisi, creare ADR e aggiornare questa guida.

