# Guida Git, PR e pubblicazione

Questa guida definisce la policy Git/PR per SyncBay e il significato operativo di "pubblicare" nella fase corrente.

Decisione di riferimento: `docs/decisions/0003-git-pubblicazione-versioning.md`.

## Stato corrente

- Repo Git locale inizializzata e collegata a GitHub.
- Remote GitHub: https://github.com/max23468/SyncBay
- Branch predefinito: `main`.
- Issue e PR template configurati in `.github/`.
- Workflow `Codex PR comments` configurato per mantenere la issue `Codex feedback inbox`.
- Dependabot configurato per GitHub Actions e npm.
- Versioning locale attivo con `app/lib/version.ts` e `npm run release`.
- Nessun deploy production deciso.
- Nessuna CI runtime definita.

## Regola base

Prima di ogni modifica:

```bash
git status --short --branch
```

Non sovrascrivere modifiche non tue. Se il worktree è sporco per un filone diverso, separare il lavoro prima di modificare file sovrapposti.

## Commit

Usare Conventional Commit. Il tipo deve riflettere l'impatto reale, non il lavoro interno:

- `docs:` documentazione;
- `feat:` nuova funzionalità osservabile;
- `fix:` correzione osservabile;
- `perf:` miglioramento prestazionale osservabile;
- `chore:` manutenzione;
- `refactor:` refactor senza cambio comportamento;
- `test:` test;
- `ci:` CI/workflow.

Se una PR contiene sia refactor sia bugfix o feature, il titolo/commit deve usare il tipo più alto (`fix:` o `feat:`), non `refactor:`.

Per breaking change futuri, usare `!` nel tipo commit o un footer `BREAKING CHANGE:`.

## Branch e PR

Percorso standard per lavori non banali:

1. parti da `main` aggiornato;
2. crea un branch `codex/<tema>`;
3. mantieni il diff focalizzato;
4. esegui le verifiche locali rilevanti;
5. apri PR verso `main` usando il template;
6. fai self-review e correggi problemi chiari;
7. mergea quando la PR è pronta;
8. elimina branch remoto e branch locale quando il lavoro è assorbito.

Per modifiche minuscole e chiaramente docs-only è ammesso commit diretto su `main`, se il diff resta limitato a `AGENTS.md`, `README.md`, `CHANGELOG.md`, `ROADMAP.md`, `BRAND.md` o `docs/**` e non introduce ambiguità su runtime, workflow, deploy, release o segreti.

Prima di eliminare un branch locale assorbito:

```bash
git branch -d <branch>
```

Se Git rifiuta ma il lavoro è già assorbito, verifica prima:

```bash
git log --cherry-pick --right-only --oneline main...<branch>
```

Usa `git branch -D <branch>` solo se il comando non mostra commit unici da conservare.

## Cosa significa pubblicare

Nella fase attuale:

- "pubblica", "manda su GitHub", "carica" = portare il diff su GitHub e su `main`, con commit/push diretto per docs-only piccoli oppure PR/merge per lavori non banali;
- una PR aperta o un push su branch non bastano se l'utente chiede pubblicazione completa;
- "deploya" non ha effetto operativo finché non esiste un deploy production deciso;
- "rilascia" significa preparare una release locale con `npm run release`, senza tag o GitHub Release.

Quando il deploy production esisterà, "pubblicato" significherà almeno:

1. branch di lavoro mergeato su `main`;
2. controlli locali/remoti rilevanti superati;
3. eventuale deploy verificato se il deploy esiste ed è richiesto dalla modifica;
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

## Commenti Codex sulle PR

Il workflow `.github/workflows/codex-pr-comments.yml` mantiene una issue operativa chiamata `Codex feedback inbox`.

Il workflow:

- analizza PR aperte e recenti;
- cerca review thread scritti da account che matchano `codex`;
- distingue thread actionable da thread risolti o outdated;
- aggiorna la inbox;
- quando trova thread actionable non ancora richiesti, commenta la PR con `@codex address that feedback`.

Prima di mergiare una PR non banale, controllare la inbox e la PR corrente. Se ci sono thread actionable, risolverli o dichiarare esplicitamente perché restano fuori scope.

## Docs-only

Per modifiche puramente documentali:

- `git diff --check` e review del contenuto sono sufficienti;
- non inventare test applicativi;
- aggiornare `CHANGELOG.md` sotto `Non versionato` quando la modifica è significativa.

## Check prima della chiusura

Prima di dichiarare completata una modifica:

1. controlla `git status --short --branch`;
2. controlla il diff finale o il commit finale;
3. verifica se `CHANGELOG.md` deve essere aggiornato;
4. se c'è una PR, assicurati che il titolo sia Conventional Commit;
5. se hai mergeato una PR, fai cleanup branch;
6. dichiara eventuali limiti: niente deploy production, release locale non necessaria, check non eseguibili.

## Deploy e release

Finché SyncBay non ha deploy production:

- non creare deploy;
- non creare GitHub Release;
- non creare tag SemVer;
- non introdurre Release Please senza ADR;
- non aggiungere CI runtime senza comandi reali e policy esplicita.

Il versioning locale è definito in `docs/decisions/0006-versioning-runtime-locale.md`. La policy futura di CI e deploy è definita in `docs/decisions/0004-runtime-ci-release-future.md`.
