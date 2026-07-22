# Guida Git, PR e pubblicazione

Questa guida definisce la policy Git/PR per SyncBay e il significato operativo di "pubblicare" nella fase corrente.

Decisione di riferimento: `docs/decisions/0003-git-pubblicazione-versioning.md`.

## Stato corrente

- Repo Git locale inizializzata e collegata a GitHub.
- Remote GitHub: https://github.com/max23468/SyncBay
- Branch predefinito: `main`.
- Issue e PR template configurati in `.github/`.
- Workflow `Codex PR comments` configurato per mantenere la issue `Codex feedback inbox`.
- Dependabot configurato per GitHub Actions e npm, con auto-merge squash delle
  sole PR patch/minor dopo i check obbligatori di `main`.
- Versioning locale attivo con `app/lib/version.ts` e `npm run release`.
- Deployment Vercel production attivo per la distribuzione privata e verifiche controllate.
- Repository pubblico protetto da PR, `Verifica proporzionata` e dal check
  minimale separato del titolo Conventional Commit.
- React Doctor `latest` resta advisory: pubblica score e review sui file React
  cambiati, ma i finding non generano un run fallito; fallisce soltanto se lo
  scanner non riesce a completarsi. CodeQL, Vercel e inbox Codex
  restano check mirati o advisory e non bloccano indiscriminatamente ogni PR.

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
5. esegui `npm run review:pre-pr -- --base origin/main`, fai self-review del
   diff e correggi i problemi chiari;
6. esegui `npm run verify:changed -- --base origin/main`, che seleziona e
   deduplica la corsia applicabile;
7. esegui `npm run publish:complete`: il comando fa push, apre la PR se manca,
   la controlla, aspetta i soli check richiesti, mergea, verifica il deploy
   applicabile e pubblica l'eventuale release SemVer;
8. elimina branch e worktree locali quando il lavoro è assorbito.

Il commit diretto su `main` non è più praticabile, nemmeno per docs-only: la ruleset GitHub "Protezione main proporzionata" richiede la PR (verificato il 2026-07-17 con push respinto). Anche le modifiche minuscole ai documenti canonici passano da un branch `codex/<tema>` e da una PR squash.

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

- "pubblica", "manda su GitHub", "carica" = portare il diff su GitHub e su `main`
  con branch dedicato e PR/merge; se il diff contiene
  sezioni versionate nel blocco `[Non rilasciato]` del changelog, eseguire anche
  `npm run release` prima di commit/push, così versione e pubblicazione restano nello stesso flusso.
- una PR aperta o un push su branch non bastano se l'utente chiede pubblicazione completa;
- "deploya" = aggiornare e verificare il deployment Vercel production della distribuzione privata, senza implicare App Store, billing, tag o GitHub Release;
- "rilascia" significa preparare una release locale con `npm run release` e pubblicarla su GitHub/main con lo stesso flusso; tag e GitHub Release valgono solo per release prodotto reali secondo ADR `0008`.

Con il deployment Vercel production privato attivo, "pubblicato" significa almeno:

1. branch di lavoro mergeato su `main`;
2. controlli locali/remoti rilevanti superati;
3. release locale eseguita e inclusa nel commit quando il blocco `[Non rilasciato]` di `CHANGELOG.md` contiene sezioni versionate;
4. deploy Vercel production verificato quando la modifica tocca runtime o UI;
5. branch dedicato pulito localmente, worktree chiuso e branch remoto su GitHub
   chiuso/assorbito, salvo motivo esplicito.

"Pubblicare" applica il flusso completo di questa fase (`npm run release` per diff versionati, `main`/PR/merge, verifica e cleanup); non implica automaticamente creare tag, GitHub Release, billing o pubblicazione Shopify App Store, che entrano invece solo quando sono previsti dal flusso corrente o esplicitamente richiesti.

## Impostazioni GitHub correnti

- repository pubblico con solo squash merge e cancellazione automatica dei
  branch assorbiti;
- PR obbligatoria verso `main`, senza approval obbligatorie per il maintainer
  unico e con conversazioni da risolvere;
- check richiesti `Verifica proporzionata` e `Conventional PR title`, senza
  policy strict/up-to-date per evitare rebase e run duplicati;
- nessun deployment, React Doctor, CodeQL aggregato o Supabase Preview
  richiesto come status separato;
- push forzati e cancellazione di `main` vietati;
- secret scanning e push protection GitHub attivi.

## Self-review pre-PR

Prima di aprire o sincronizzare una PR non banale, usare:

```bash
npm run review:pre-pr -- --base origin/main
```

Il comando legge il diff rispetto alla base scelta più eventuali file
staged/unstaged e produce una checklist mirata alle aree toccate. Serve a
spostare prima della PR i commenti Codex prevedibili: diagnosi non provata,
root cause non isolata, fix troppo largo, guardrail server-side mancanti,
test insufficienti, mismatch UI/backend, rischio dati/provider e
classificazione release.

Il comando non sostituisce test, build o review umana. Per docs-only piccoli
può bastare `git diff --check` e rilettura del documento, come indicato sotto.
Per runtime, UI, provider, database o tooling condiviso, la checklist deve
essere chiusa prima della PR o dichiarata esplicitamente nel riepilogo.

## Commenti Codex sulle PR

Il workflow `.github/workflows/codex-pr-comments.yml` mantiene una issue operativa chiamata `Codex feedback inbox`.

Il workflow:

- sugli eventi PR analizza la PR corrente e le PR già presenti nella inbox;
- sullo schedule giornaliero, dispatch manuale o refresh della inbox analizza PR aperte,
  PR recenti degli ultimi 7 giorni e PR già presenti nella inbox;
- ignora i commenti su issue ordinarie che non sono PR o la inbox Codex;
- mantiene un opt-in `CODEX_FULL_SCAN=true` per scansioni storiche complete;
- cerca review thread scritti da account che matchano `codex`;
- distingue thread actionable da thread risolti o outdated;
- aggiorna la inbox;
- evita aggiornamenti della issue quando il contenuto non cambia.

Prima di mergiare una PR non banale, controllare i review thread Codex della PR
corrente. Il preflight remoto usa i thread GitHub come fonte primaria e legge
la `Codex feedback inbox` solo se i thread non sono disponibili o durante il
controllo post-merge su `main`. La inbox resta la dashboard globale del
workflow, ma thread di altre PR non vengono riletti nel preflight della PR
corrente.

## Docs-only

Per modifiche puramente documentali:

- `npm run verify:changed -- --base origin/main` seleziona la corsia
  `git diff --check`; review del contenuto e questo check sono sufficienti;
- non inventare test applicativi;
- aggiornare `CHANGELOG.md` sotto `Non versionato` quando la modifica è significativa.

Anche la CI distingue docs-only e runtime mantenendo un unico job conclusivo;
React Doctor `latest` non parte quando nessun path di sua
competenza cambia. Vercel salta inoltre i build limitati a docs, governance,
CI, test e tooling non runtime.

La CI non installa Chromium per ogni sincronizzazione. Le PR con UI sostanziale
ricevono la label `full-ui-check`, che avvia render e hydration browser in un
workflow dedicato; lo stesso workflow può essere lanciato manualmente. Il
workflow della inbox Codex non si riavvia a ogni push: i review thread restano
comunque letti dal preflight finale.

## Check prima della chiusura

Prima di dichiarare completata una modifica:

1. controlla `git status --short --branch`;
2. controlla il diff finale o il commit finale;
3. verifica se `CHANGELOG.md` deve essere aggiornato e se `npm run release` deve essere eseguito;
4. se c'è una PR, assicurati che il titolo sia Conventional Commit;
5. se hai mergeato una PR, fai cleanup branch;
6. dichiara eventuali limiti: niente deploy production, release locale non necessaria perché il blocco è solo `Non versionato`, check non eseguibili.

## Deploy e release

Finché SyncBay resta in deployment Vercel production per distribuzione privata:

- usare Vercel production solo per verifiche controllate dello store pilota Numisleo;
- non creare GitHub Release o tag SemVer fuori da una release prodotto reale;
- non introdurre Release Please senza ADR;
- non aggiungere nuovi workflow CI/runtime o deploy senza comandi reali e policy
  esplicita; i gate PR esistenti restano limitati al perimetro documentato.

Il versioning locale è definito in `docs/decisions/0006-versioning-runtime-locale.md`. Tag e GitHub Release sono definiti in `docs/decisions/0008-tag-e-github-release.md`. La policy futura di CI e deploy è definita in `docs/decisions/0004-runtime-ci-release-future.md`.
