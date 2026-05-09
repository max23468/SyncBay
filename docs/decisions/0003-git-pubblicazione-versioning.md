# ADR 0003 - GitHub, pubblicazione e versioning

- **Stato**: Accettato
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay e un repository docs-first, gia collegato a GitHub, ma senza runtime applicativo, deploy, CI o release versionate.

Il maintainer vuole una disciplina simile alle repo operative esistenti:

- Pratix come riferimento principale per pubblicazione su GitHub/main, PR, changelog e distinzione tra pubblicare e rilasciare;
- DocMolder come riferimento per branch dedicati, PR verso `main`, cleanup branch e flusso completo quando una modifica e rilasciabile;
- FiscalBay come riferimento per Conventional Commit, separazione tra pubblicazione codice, deploy operativo e release versionata.

Il vincolo specifico di SyncBay e non introdurre scaffold, workflow, deploy o release automation prima che siano decisi.

## Decisione

GitHub e la fonte primaria per documentazione e codice SyncBay. Fino allo scaffold, la pubblicazione consiste nel portare modifiche coerenti su `main` GitHub; la release SemVer runtime resta non attiva.

## Policy operativa

### Branch, PR e commit

- Per lavori non banali usare branch `codex/<tema>` e PR verso `main`.
- Per modifiche minuscole e chiaramente docs-only e ammesso commit diretto su `main`, se non tocca runtime, workflow, deploy, release o segreti.
- I commit e i titoli PR devono seguire Conventional Commit.
- Il tipo deve riflettere l'impatto reale:
  - `docs:` per documentazione;
  - `feat:` per nuova funzionalita osservabile futura;
  - `fix:` per correzione osservabile;
  - `perf:` per miglioramenti prestazionali osservabili;
  - `chore:`, `refactor:`, `test:`, `ci:` solo quando non mascherano cambi rilasciabili.
- Prima di commit, PR o merge, fare self-review del diff e verifiche locali rilevanti.

### Pubblicare

Nella fase attuale:

- "pubblica", "manda su GitHub" o "carica" significa portare il lavoro su GitHub/main;
- per docs-only piccoli bastano commit e push diretti;
- per lavori non banali serve PR/merge;
- una PR aperta o un push su branch non bastano se l'utente ha chiesto pubblicazione completa.

Quando esistera runtime, pubblicazione completa includera anche controlli/deploy coerenti con la policy attiva.

### Deploy e release

Nella fase attuale:

- "deploya" non ha effetto operativo perche non esiste deploy;
- "rilascia" richiede prima decisione esplicita su runtime, SemVer e automazione;
- non creare tag GitHub, GitHub Release, Release Please, script release o workflow Actions senza ADR.

Quando esistera runtime, ogni modifica dovra essere classificata come `MAJOR`, `MINOR`, `PATCH` o `Non versionato` prima della chiusura.

### Changelog

Durante la fase docs-first:

- usare `CHANGELOG.md` sotto `## [Non rilasciato]` e `### Non versionato`;
- annotare modifiche significative a piani, ADR, guide, regole operative, brand, asset e configurazione GitHub;
- non creare versioni applicative.

Quando esistera runtime:

- `Novita` indichera nuove funzionalita compatibili;
- `Correzioni` indichera bugfix e sicurezza;
- `Sotto il cofano` indichera hardening, infra, refactor e manutenzione runtime;
- `Non versionato` restera per piani, ADR, guide interne e regole agenti.

### Cleanup post-merge

Dopo merge o pubblicazione completa, eliminare branch remoti/locali non piu necessari.

Se `git branch -d <branch>` rifiuta l'eliminazione, verificare prima:

```bash
git log --cherry-pick --right-only --oneline main...<branch>
```

Usare `git branch -D` solo se non ci sono commit unici da conservare.

## Conseguenze

- SyncBay ha un percorso chiaro per pubblicare su GitHub senza inventare runtime.
- Le parole "pubblica", "deploya" e "rilascia" hanno significati distinti.
- Il changelog resta utile anche nella fase documentale.
- Il futuro flusso SemVer e pronto concettualmente, ma non vincola ancora tool o file non esistenti.

## Alternative considerate

- **Copiare Release Please da DocMolder**: scartato per ora, perche SyncBay non ha runtime ne package.
- **Copiare script release/deploy da FiscalBay**: scartato per ora, perche SyncBay non ha VPS o runtime operativo.
- **Copiare Pratix con `APP_VERSION` subito**: scartato per ora, perche non esiste app o file versione.

## Riferimenti

- `AGENTS.md`
- `docs/guides/git-e-pubblicazione.md`
- `docs/guides/versioning-e-release.md`
- `CHANGELOG.md`
