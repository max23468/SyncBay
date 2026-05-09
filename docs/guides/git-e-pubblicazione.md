# Guida Git e pubblicazione

Questa guida definisce la policy provvisoria Git/PR per SyncBay.

## Stato corrente

- Repo Git locale inizializzata e collegata a GitHub.
- Remote GitHub: https://github.com/max23468/SyncBay
- Branch predefinito: `main`.
- Issue e PR template configurati in `.github/`.
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

## Branch e PR

- usare branch dedicati per lavori non banali: `codex/<tema>`;
- aprire PR verso `main`;
- tenere PR piccole e reviewable;
- includere sintesi, file toccati, rischi, verifiche e prossimi passi;
- eliminare branch locali/remoti quando il lavoro e mergeato e assorbito;
- non introdurre deploy/release impliciti con la sola parola "pubblica".

## Impostazioni GitHub iniziali

La configurazione iniziale segue Pratix come riferimento principale:

- repo privata;
- issue e projects abilitati;
- wiki e discussions disabilitati;
- merge commit, squash merge e rebase merge abilitati;
- auto-merge disabilitato;
- cancellazione automatica branch dopo merge disabilitata;
- label `codex`, `autorelease: pending` e `autorelease: tagged` presenti per coerenza con le altre repo operative.

Branch protection e rulesets non sono attivi sulle repo private dell'account corrente senza GitHub Pro o repo pubblica.

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
