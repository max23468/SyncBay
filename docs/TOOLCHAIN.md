# Toolchain - SyncBay

Questo documento dichiara runtime, package manager, lockfile, tool e verifiche applicabili a SyncBay.

## Runtime locale

| Area                      | Valore                                        |
| ------------------------- | --------------------------------------------- |
| Runtime principale        | Node.js                                       |
| Versione locale preferita | `.node-version` = `24.18.0`                   |
| Range supportato          | `package.json` `engines.node` = `>=24.15 <25` |
| Enforcement engine        | `.npmrc` con `engine-strict=true`             |
| Package manager           | `npm@11.17.0`                                 |
| Lockfile                  | `package-lock.json`                           |

Il floor Node `>=24.15` resta il minimo verificato per la catena React Doctor
risolta dinamicamente su `latest`; non abbassarlo senza rivalidare il quality
gate corrente. Il package manager canonico è dichiarato in
`package.json` come `npm@11.17.0`. Il deploy avviene solo su Vercel: il
percorso Docker (Dockerfile, `.dockerignore`, script `docker-start`) è stato
rimosso e le dipendenze necessarie solo a build, tooling e migration locali
vivono in `devDependencies`.

Guardia locale: i checkout e i worktree SyncBay devono risolvere `node` dalla
toolchain coerente con `.node-version`, non dal Node Homebrew globale. Sulla
postazione Codex attuale l'allineamento persistente passa dagli shim `mise`; se
un comando mostra Node 26.x, fermarsi e verificare prima `command -v node`,
`node --version`, `mise current` e l'attivazione degli shim nella shell, senza
forzare installazioni o downgrade dentro la repo.

## Stack applicativo

| Area                        | Tool                                  |
| --------------------------- | ------------------------------------- |
| Shopify app                 | Shopify CLI `4.4.0`                   |
| Shopify Admin/Webhook API   | `2026-07`                             |
| Frontend/backend app        | React Router, React, TypeScript, Vite |
| Hosting previsto            | Vercel                                |
| Database                    | Supabase Postgres                     |
| ORM                         | Prisma `7.8.0` con `@prisma/adapter-pg` |
| Queue e scheduler previsti  | Supabase Queues e Supabase Cron       |
| Storage immagini temporaneo | Supabase Storage privato              |
| Osservabilità baseline      | Vercel Web Analytics e Speed Insights |
| Quality React               | React Doctor                          |

## Aggiornamenti automatici

Dependabot è abilitato per npm e GitHub Actions, ma i major accoppiati restano
manuali quando la catena peer o il runtime non sono già compatibili. In
particolare React Router 8 non deve essere aperto come bump parziale: SyncBay
usa il preset `@vercel/react-router` e la versione `1.3.1` dichiara peer su
React Router 7. La migrazione a React Router 8 va quindi fatta in una branch
dedicata aggiornando insieme `react-router`, i pacchetti `@react-router/*` e il
preset Vercel solo quando esiste una versione compatibile.

Finché SyncBay resta su React Router 7 con Vite 8, `@react-router/dev@7.18.1`
è patchato con `patch-package` perché la sua configurazione vite-node interna
usa ancora l'opzione deprecata `envFile: false`. La patch versionata in
`patches/@react-router+dev+7.18.1.patch` sostituisce quell'opzione con
`envDir: false` e viene riapplicata da `postinstall`. `patch-package` vive in
`devDependencies`: senza il percorso Docker non esiste più un install
`--omit=dev` che debba eseguire `postinstall`. Rimuovere la patch solo insieme
a una migrazione verificata a una release React Router/preset Vercel che non
emetta più quel warning.

Prisma è aggiornato a 7.8.0 con `prisma.config.ts`, generator di compatibilità
`prisma-client-js`, output `prisma/generated/client` ignorato da Git e link
post-generate verso il path atteso da `@prisma/client`. Questa scelta mantiene
compatibili il test runner Node nativo e il template React Router finché il
client `prisma-client` TypeScript non sarà adottabile senza loader dedicati. Il
runtime usa `@prisma/adapter-pg`; lo storage sessioni Shopify è locale perché
`@shopify/shopify-app-session-storage-prisma` non dichiara ancora compatibilità
con Prisma 7. Future major Prisma restano manuali.

I tipi Node oltre la major del runtime dichiarato richiedono un pass manuale:
il runtime repo resta `>=24.15 <25`.

## Comandi locali

| Scopo                         | Comando                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Installazione                 | `npm install`                                                                               |
| Sviluppo Shopify              | `npm run dev`                                                                               |
| Typecheck                     | `npm run typecheck`                                                                         |
| Lint                          | `npm run lint`                                                                              |
| Build                         | `npm run build`                                                                             |
| Smoke UI                      | `npm run smoke:ui`                                                                          |
| Render UI fixture isolato     | `npm run ui:check`                                                                          |
| Browser UI fixture isolato    | `npm run ui:browser-check`                                                                  |
| Misura performance loader     | `npm run perf:loaders -- --since 10m`                                                       |
| Screenshot UI Admin live      | `npm run ui:shot-live -- [VoceNav] [nome-output]`                                           |
| Test librerie pure            | `npm run test:lib`                                                                          |
| Test servizi server           | `npm run test:services`                                                                     |
| Test runtime completo         | `npm run test:runtime`                                                                      |
| Coverage moduli puri          | `npm run coverage:lib`                                                                      |
| Audit produzione              | `npm run audit:prod`                                                                        |
| Generazione Prisma            | `npm run prisma:generate`                                                                   |
| Validazione Prisma            | `npm run prisma:validate`                                                                   |
| Advisor Supabase              | `npm run db:verify`                                                                         |
| Servizi HTTP Supabase         | `npm run supabase:services`                                                                 |
| Doctor locale                 | `npm run doctor:local`                                                                      |
| Creazione worktree            | `npm run worktree:create -- --branch codex/<tema> [--base origin/main] [--dry-run]`         |
| Ripresa setup worktree        | `npm run worktree:prepare`                                                                  |
| Self-review pre-PR            | `npm run review:pre-pr -- --base origin/main`                                               |
| Preflight pubblicazione       | `npm run publish:preflight -- --remote`                                                     |
| Pubblicazione completa PR     | `npm run publish:complete [-- --pr <numero>]`                                               |
| Verifica automatica del diff  | `npm run verify:changed -- --base origin/main`                                              |
| Verifica runtime completa     | `npm run verify:full [-- --force]`                                                          |
| Verifica pubblicazione        | `npm run verify:publish -- --remote`                                                        |
| Diagnostica job import        | `npm run jobs:status -- --shop <shop.myshopify.com>`                                   |
| Budget egress Supabase        | `npm run egress:budget -- --budget-gb 5`                                                    |
| Budget storage database       | `npm run db:storage-budget`                                                                 |
| Budget Supabase Storage       | `npm run storage:budget`                                                                    |
| Budget provider aggregato     | `npm run provider:budget`                                                                   |
| Budget bundle                  | `npm run bundle:budget`                                                                     |
| Verifica documentazione       | `npm run docs:check`                                                                        |
| Backup database (dry-run)     | `npm run db:backup`                                                                         |
| Prova restore non-production  | `npm run db:restore-check`                                                                  |
| Backfill baseline prodotto    | `npm run product-baselines:backfill -- --dry-run`                                           |
| Maintenance storia prodotto  | `npm run history:maintain -- --dry-run`                                                     |
| Archivio job storici          | `npm run jobs:archive-stale-failures -- --shop <shop.myshopify.com> --apply`           |
| Pensionamento import legacy   | `npm run jobs:retire-internal-import -- --dry-run`                                           |
| Coalescenza webhook Shopify   | `npm run jobs:coalesce-shopify-changes -- --shop <shop.myshopify.com> [--apply]`       |
| Doctor conflitti/stale        | `npm run conflicts:doctor -- --shop <shop.myshopify.com>`                              |
| Limiti eBay Trading           | `npm run ebay:rate-limits -- --shop <shop.myshopify.com>`                              |
| Readiness ordini pagati       | `npm run orders:paid-readiness -- --shop <shop.myshopify.com>`                         |
| Verifica campione import      | `npm run import:verify -- --shop <shop.myshopify.com> --sample 10`                     |
| Report pulizia descrizioni    | `npm run descriptions:cleanup-report -- --shop <shop.myshopify.com> --sample 20`       |
| Riparazione prezzo/SKU        | `npm run import:repair-commercial-fields -- --shop <shop.myshopify.com> --dry-run`     |
| Ripristino stock eBay         | `npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write` |
| Orfani categoria negozio      | `npm run ebay:store-category-orphans -- --shop <shop.myshopify.com> [--limit N]`       |
| Dry-run categorie             | `npm run categories:backfill -- --shop <shop.myshopify.com> [--limit N]`               |
| Backfill descrizioni pulite   | `npm run descriptions:backfill-cleanup -- --shop <shop.myshopify.com> [--limit N]`     |
| Dry-run faccette storefront   | `npm run facets:backfill -- --shop <shop.myshopify.com> [--limit N]`                   |
| Doctor collezioni             | `npm run collections:doctor -- --shop <shop.myshopify.com> [--intent-file f.json] [--json] [--limit-products N]` |
| Diagnostica immagini Catalogo | `npm run catalog:images:doctor -- --shop <shop.myshopify.com> [--limit N]`             |
| Test guardia stock eBay       | `npm run test:stock-guard`                                                                  |
| Test script e workflow        | `npm run test:tooling`                                                                      |
| React Doctor latest           | `npm run quality:react-doctor`                                                              |
| Release dry-run               | `npm run release:dry-run`                                                                   |
| Release locale                | `npm run release`                                                                           |

Per prerequisiti, guardie e modalità apply dei comandi operativi usa la guida
[`guides/comandi-manutenzione.md`](guides/comandi-manutenzione.md). Aprila solo
quando il task riguarda diagnostica o manutenzione live.

### Copertura dei moduli server

La copertura reale si ricava dai test presenti, non da un inventario manuale.
Quando cambia un modulo `app/services`, aggiungi o aggiorna un test server o di
contratto proporzionato al rischio ed esegui `npm run test:runtime`.

`npm run build` esegue `npm run prisma:generate` tramite `prebuild`, mantenendo
il Prisma Client allineato allo schema anche nei deploy con cache installazione.

I comandi standalone `build`, `typecheck` e `test:services` mantengono la
generazione Prisma preventiva. `npm run verify:full` genera invece Prisma una
sola volta e usa le varianti interne `*:raw`; esegue i test tooling, usa
`coverage:lib` come unica esecuzione dei test puri e poi esegue i test servizi,
evitando duplicazioni.

`verify:changed` e `verify:full` salvano ricevute ignorate da Git in
`.cache/syncbay-verification/`. Una ricevuta viene riusata solo se fingerprint
di diff, file untracked, lockfile, Node e lista comandi è invariato. `--force`
impone una prova fresca; `--no-receipt` è la modalità CI. Check con placeholder
o provider live restano esplicitamente manuali e non vengono memorizzati.

### Creazione worktree

Dal checkout principale usa:

```bash
npm run worktree:create -- --branch codex/<tema>
```

Il comando usa `origin/main` come base esplicita, deriva il percorso
`.worktrees/<tema>` e fallisce prima di modificare Git se è già dentro una
worktree, la directory non è ignorata, il ref base manca oppure branch o
percorso collidono. `--dry-run` mostra il piano senza creare nulla.

Dopo `git worktree add`, il setup esegue in serie `npm install`, una sola
generazione Prisma, doctor locale, test delle librerie e test dei servizi raw;
alla fine richiede un checkout pulito. Se uno step fallisce, la worktree viene
lasciata ispezionabile e il setup si riprende al suo interno con
`npm run worktree:prepare`, senza una seconda creazione o retry ciechi.

## Verifiche per tipo di modifica

| Tipo modifica                                                       | Verifiche proporzionate                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docs-only                                                           | Review contenuto e `npm run verify:changed -- --base origin/main`                                                                                      |
| Pre-PR non banale                                                   | `npm run review:pre-pr -- --base origin/main`, chiusura dei punti emersi, poi `npm run verify:changed -- --base origin/main`                           |
| Runtime TypeScript/UI ordinario                                     | `npm run verify:changed -- --base origin/main`; aggiungere verifica browser quando cambia il comportamento visibile                                    |
| Moduli `app/services`, runtime condiviso o CI                        | `npm run verify:full -- --force`; aggiungere test mirati prima del gate completo                                                                       |
| Moduli puri `app/lib`                                               | test del file durante l'iterazione, poi `npm run verify:changed -- --base origin/main`                                                                  |
| Pubblicazione/merge PR                                              | `npm run verify:publish -- --remote`; aggiungere `npm run conflicts:doctor` quando il lavoro tocca conflitti, stale o retry                            |
| Qualità React dopo release major/minor o cambi UI/React trasversali | `npm run quality:react-doctor`, che risolve esplicitamente `react-doctor@latest`                                                                         |
| Flussi UI principali                                                | `npm run smoke:ui` quando il dev server o lo script sono applicabili                                                                                   |
| Prisma/database                                                     | `npm run prisma:validate`, `npm run audit:prod`; `npm run db:verify` se Supabase linked è disponibile                                                 |
| Guardia stock eBay, valuta o dry-run                                | `npm run test:stock-guard`; poi `npm run typecheck`, `npm run lint`, `npm run build`                                                                   |
| Versioning/changelog runtime                                        | `npm run release:dry-run`                                                                                                                              |

La CI PR mantiene un unico job conclusivo: per diff docs-only esegue soltanto
`git diff --check`; per gli altri diff esegue `verify:changed -- --no-receipt`
e quindi soltanto test, typecheck, lint, build e smoke dedotti dalle superfici
toccate. React Doctor resta nel workflow parallelo advisory e non viene
duplicato nel check richiesto.

Render SSR e hydration Chromium non vengono più pagati a ogni push. Il workflow
`UI browser check` parte manualmente o applicando la label `full-ui-check` alle
PR con modifiche UI sostanziali. `verify:full` locale continua a includere tutti
i gate ed è la prova completa prima della PR quando il rischio lo richiede.

Vercel usa `scripts/syncbay-vercel-ignore-build.mjs`: docs, governance, CI,
test e tooling non runtime non generano build, mentre runtime, Prisma, asset,
dipendenze, configurazione o file non classificati mantengono il fallback
conservativo al build.

`npm run publish:complete` è il percorso canonico dopo il commit: esegue push,
apre la PR se manca usando il titolo del commit, lancia il preflight remoto una
sola volta, aspetta solo i check
richiesti dal ruleset, fa squash merge, attende e verifica Vercel Production
solo per diff deployable e pubblica tag/GitHub Release solo quando
`APP_VERSION` è aumentata. I check advisory continuano in parallelo senza
allungare artificialmente il percorso critico.

## Deploy e release

SyncBay ha versioning locale, un deployment Vercel production per distribuzione privata e una
policy tag/GitHub Release per release prodotto reali. Non ha ancora una policy
di release pubblica Shopify App Store.

- `pubblica` significa portare il lavoro su GitHub/main secondo
  `docs/guides/git-e-pubblicazione.md`, includendo `npm run release` quando il
  blocco `[Non rilasciato]` del changelog contiene sezioni versionate, con PR/merge o commit diretto previsto,
  controlli completi e cleanup branch/worktree locali e remoti al termine quando
  assorbito.
- `rilascia` significa usare il flusso locale `npm run release`, pubblicare la
  release su GitHub/main nello stesso flusso operativo e, per release prodotto
  reale, creare tag Git `vX.Y.Z` e GitHub Release.
- `deploya` significa aggiornare il deployment Vercel production della distribuzione privata e
  verificarlo; non implica App Store, billing, tag o GitHub Release.
- tag Git `vX.Y.Z` e GitHub Release si creano per ogni release prodotto reale secondo ADR
  `docs/decisions/0008-tag-e-github-release.md`.
