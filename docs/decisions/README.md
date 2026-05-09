# Architecture Decision Records

Questa cartella contiene le decisioni stabili del progetto.

Usa un ADR quando una scelta:

- cambia architettura o stack;
- fissa una policy operativa;
- introduce vincoli di sicurezza, deploy, dati o release;
- chiude un tradeoff importante;
- deve restare comprensibile anche fra mesi.

## Indice

- `0001-stack.md`: stack iniziale SyncBay.
- `0002-branding.md`: branding iniziale SyncBay.
- `0003-git-pubblicazione-versioning.md`: policy GitHub, pubblicazione e versioning.
- `0004-runtime-ci-release-future.md`: policy futura per runtime, CI e release dopo lo scaffold.
- `0005-runtime-infrastructure.md`: infrastruttura runtime MVP Vercel + Supabase.
- `0006-versioning-runtime-locale.md`: versioning SemVer locale in linea con Pratix.

## Convenzioni

- Numerazione progressiva `000N-titolo-breve.md`.
- Stato esplicito: Proposto, Accettato, Sostituito, Deprecato.
- Una decisione per file.
- Se una decisione cambia, non riscrivere la storia: crea un nuovo ADR o aggiorna lo stato con riferimento.
