# Guida Git, PR e pubblicazione

Questa guida definisce la policy Git/PR per SyncBay e il significato operativo di "pubblicare" nella fase corrente.

Decisione di riferimento: `docs/decisions/0003-git-pubblicazione-versioning.md`.

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
git status --short --branch
```

Non sovrascrivere modifiche non tue. Se il worktree e sporco per un filone diverso, separare il lavoro prima di modificare file sovrapposti.

## Commit

Usare Conventional Commit. Il tipo deve riflettere l'impatto reale, non il lavoro interno:

- `docs:` documentazione;
- `feat:` nuova funzionalita osservabile;
- `fix:` correzione osservabile;
- `perf:` miglioramento prestazionale osservabile;
- `chore:` manutenzione;
- `refactor:` refactor senza cambio comportamento;
- `test:` test;
- `ci:` CI/workflow.

Se una PR contiene sia refactor sia bugfix o feature, il titolo/commit deve usare il tipo piu alto (`fix:` o `feat:`), non `refactor:`.

Per breaking change futuri, usare `!` nel tipo commit o un footer `BREAKING CHANGE:`.

## Branch e PR

Percorso standard per lavori non banali:

1. parti da `main` aggiornato;
2. crea un branch `codex/<tema>`;
3. mantieni il diff focalizzato;
4. esegui le verifiche locali rilevanti;
5. apri PR verso `main` usando il template;
6. fai self-review e correggi problemi chiari;
7. mergea quando la PR e pronta;
8. elimina branch remoto e branch locale quando il lavoro e assorbito.

Per modifiche minuscole e chiaramente docs-only e ammesso commit diretto su `main`, se il diff resta limitato a `AGENTS.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `BRAND.md` o `docs/**` e non introduce ambiguita su runtime, workflow, deploy, release o segreti.

Prima di eliminare un branch locale assorbito:

```bash
git branch -d <branch>
```

Se Git rifiuta ma il lavoro e gia assorbito, verifica prima:

```bash
git log --cherry-pick --right-only --oneline main...<branch>
```

Usa `git branch -D <branch>` solo se il comando non mostra commit unici da conservare.

## Cosa significa pubblicare

Nella fase attuale docs-first:

- "pubblica", "manda su GitHub", "carica" = portare il diff su GitHub e su `main`, con commit/push diretto per docs-only piccoli oppure PR/merge per lavori non banali;
- una PR aperta o un push su branch non bastano se l'utente chiede pubblicazione completa;
- "deploya" non ha effetto operativo finche non esiste un deploy deciso;
- "rilascia" richiede prima una policy runtime e, oggi, va trattato come decisione da chiudere prima dell'azione.

Quando il runtime esistera, "pubblicato" significhera almeno:

1. branch di lavoro mergeato su `main`;
2. controlli locali/remoti rilevanti superati;
3. eventuale deploy verificato se il deploy esiste ed e richiesto dalla modifica;
4. branch dedicato pulito localmente e su GitHub, salvo motivo esplicito.

"Pubblicare" non significa automaticamente creare tag, GitHub Release, deploy, billing o pubblicazione Shopify App Store.

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

## Check prima della chiusura

Prima di dichiarare completata una modifica:

1. controlla `git status --short --branch`;
2. controlla il diff finale o il commit finale;
3. verifica se `CHANGELOG.md` deve essere aggiornato;
4. se c'e una PR, assicurati che il titolo sia Conventional Commit;
5. se hai mergeato una PR, fai cleanup branch;
6. dichiara eventuali limiti: niente deploy, niente release runtime, check non eseguibili.

## Deploy e release

Finche SyncBay non ha runtime:

- non creare deploy;
- non creare GitHub Release;
- non creare tag SemVer;
- non introdurre Release Please o script di release senza ADR;
- non aggiungere workflow GitHub Actions senza richiesta esplicita.

Quando questi flussi verranno decisi, creare ADR e aggiornare questa guida.
