# ADR 0003 - GitHub, pubblicazione e versioning

- **Stato**: Accettato
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay è nato come repository docs-first, già collegato a GitHub, e ora contiene uno scaffold Shopify CLI React Router con versioning locale attivo.

Il maintainer vuole una disciplina simile alle repo operative esistenti:

- Pratix come riferimento principale per pubblicazione su GitHub/main, PR, changelog e distinzione tra pubblicare e rilasciare;
- DocMolder come riferimento per branch dedicati, PR verso `main`, cleanup branch e flusso completo quando una modifica è rilasciabile;
- FiscalBay come riferimento per Conventional Commit, separazione tra pubblicazione codice, deploy operativo e release versionata.

Il vincolo specifico di SyncBay è non introdurre workflow CI, deploy o automazioni remote di release prima che siano decisi.

## Decisione

GitHub è la fonte primaria per documentazione e codice SyncBay. La pubblicazione consiste nel portare modifiche coerenti su `main` GitHub; la release SemVer locale è definita da ADR 0006.

## Policy operativa

### Branch, PR e commit

- Per lavori non banali usare branch `codex/<tema>` e PR verso `main`.
- Per modifiche minuscole e chiaramente docs-only è ammesso commit diretto su `main`, se non tocca runtime, workflow, deploy, release o segreti.
- I commit e i titoli PR devono seguire Conventional Commit.
- Il tipo deve riflettere l'impatto reale:
  - `docs:` per documentazione;
  - `feat:` per nuova funzionalità osservabile futura;
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

Quando esisterà deploy production, pubblicazione completa includerà anche controlli/deploy coerenti con la policy attiva.

### Deploy e release

Nella fase attuale:

- "deploya" non ha effetto operativo perché non esiste deploy production deciso;
- "rilascia" usa la procedura locale documentata in ADR 0006;
- tag GitHub e GitHub Release seguono ADR 0008;
- non creare Release Please o workflow Actions di release senza ADR.

Ogni modifica deve essere classificata come `MAJOR`, `MINOR`, `PATCH` o `Non versionato` prima della chiusura.

### Changelog

- `Novità` indica nuove funzionalità compatibili.
- `Correzioni` indica bugfix e sicurezza.
- `Sotto il cofano` indica hardening, infra, refactor e manutenzione runtime.
- `Non versionato` resta per piani, ADR, guide interne e regole agenti.

### Cleanup post-merge

Dopo merge o pubblicazione completa, eliminare branch remoti/locali non più necessari.

Se `git branch -d <branch>` rifiuta l'eliminazione, verificare prima:

```bash
git log --cherry-pick --right-only --oneline main...<branch>
```

Usare `git branch -D` solo se non ci sono commit unici da conservare.

## Conseguenze

- SyncBay ha un percorso chiaro per pubblicare su GitHub senza inventare runtime.
- "Pubblica" resta la chiusura del flusso completo (PR/merge, verifiche e cleanup
  degli spazi temporanei); "deploya" e "rilascia" sono azioni operative specifiche
  che entrano nel flusso quando previste dal contesto corrente.
- Il changelog resta utile anche nella fase documentale.
- Il flusso SemVer locale è attivo senza introdurre deploy automatici; tag e
  GitHub Release sono regolati da ADR 0008.

## Alternative considerate

- **Copiare Release Please da DocMolder**: scartato per ora, perché SyncBay non ha runtime né package.
- **Copiare script release/deploy da FiscalBay**: scartato per ora, perché SyncBay non ha VPS o runtime operativo.
- **Copiare Pratix con `APP_VERSION` subito**: inizialmente scartato; adottato dopo lo scaffold con ADR 0006.

## Riferimenti

- `AGENTS.md`
- `docs/guides/git-e-pubblicazione.md`
- `docs/guides/versioning-e-release.md`
- `docs/decisions/0006-versioning-runtime-locale.md`
- `CHANGELOG.md`
