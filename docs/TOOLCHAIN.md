# Toolchain - SyncBay

Questo documento dichiara runtime, package manager, lockfile, tool e verifiche applicabili a SyncBay.

## Runtime locale

| Area                      | Valore                                        |
| ------------------------- | --------------------------------------------- |
| Runtime principale        | Node.js                                       |
| Versione locale preferita | `.node-version` = `24.19.0`                   |
| Range supportato          | `package.json` `engines.node` = `>=24.15 <25` |
| Enforcement engine        | `.npmrc` con `engine-strict=true`             |
| Package manager           | `npm@12.0.2`                                  |
| Lockfile                  | `package-lock.json`                           |

Il floor Node `>=24.15` resta il minimo verificato per la catena React Doctor
pinnata nel repository; non abbassarlo senza rivalidare il quality
gate corrente. Il package manager canonico è dichiarato in
`package.json` come `npm@12.0.2`. Il deploy avviene solo su Vercel: il
percorso Docker (Dockerfile, `.dockerignore`, script `docker-start`) è stato
rimosso e le dipendenze necessarie solo a build, tooling e migration locali
vivono in `devDependencies`.

CI, Vercel e il setup delle worktree eseguono esplicitamente npm `12.0.2` prima
dell'installazione: Node 24 include ancora npm 11, che `engine-strict` rifiuta.
Nel primo setup di un checkout eseguire `npm install --global npm@12.0.2` prima
di `npm install`.

Guardia locale: i checkout e i worktree SyncBay devono risolvere `node` dalla
toolchain coerente con `.node-version`, non dal Node Homebrew globale. Sulla
postazione Codex attuale l'allineamento persistente passa dagli shim `mise`; se
un comando mostra Node 26.x, fermarsi e verificare prima `command -v node`,
`node --version`, `mise current` e l'attivazione degli shim nella shell, senza
forzare installazioni o downgrade dentro la repo.

## Stack applicativo

| Area                        | Tool                                    |
| --------------------------- | --------------------------------------- |
| Shopify app                 | Shopify CLI `4.6.0`                     |
| Shopify Admin/Webhook API   | `2026-07`                               |
| eBay Trading API            | compatibility level `1455`              |
| eBay Inventory API          | endpoint `v1`, specifica `1.18.5`       |
| eBay Notification API       | endpoint `v1`, specifica `1.6.7`        |
| eBay OAuth / Identity API   | endpoint `v1`                           |
| eBay Developer Analytics    | endpoint `v1_beta`                      |
| Frontend/backend app        | React Router, React, TypeScript, Vite   |
| Hosting previsto            | Vercel                                  |
| CLI hosting                 | Vercel CLI `58.7.1`                     |
| Database                    | Supabase Postgres                       |
| ORM                         | Prisma `7.9.1` con `@prisma/adapter-pg` |
| Queue e scheduler previsti  | Supabase Queues e Supabase Cron         |
| Storage immagini temporaneo | Supabase Storage privato                |
| Osservabilità baseline      | Vercel Web Analytics e Speed Insights   |
| Quality React               | React Doctor                            |
| Codice morto                | Knip                                    |

Versioni eBay verificate il 2026-08-06 sulle fonti ufficiali: [Trading API
release notes](https://developer.ebay.com/devzone/XML/docs/ReleaseNotes.html),
[Inventory API release
notes](https://developer.ebay.com/api-docs/sell/inventory/static/release-notes.html),
[Notification API release
notes](https://developer.ebay.com/api-docs/sell/notification/release-notes.html)
e [Developer Analytics rate
limits](https://developer.ebay.com/api-docs/developer/analytics/resources/rate_limit/methods/getUserRateLimits).
Le release minori REST aggiornano lo schema dietro lo stesso path major: non
vanno inserite nell'URL. Trading richiede invece il livello corrente sia
nell'header sia nel campo XML `Version`; entrambi derivano dalla stessa costante.

## Aggiornamenti automatici

Dependabot è abilitato per npm e GitHub Actions, ma i major accoppiati restano
manuali quando la catena peer o il runtime non sono già compatibili. Le PR
Dependabot patch e minor vengono messe in auto-merge squash: GitHub le unisce
solo dopo il superamento dei check obbligatori della ruleset di `main`. Una CI
fallita, un conflitto, un major o una PR modificata manualmente richiedono
intervento umano; non viene applicata alcuna auto-approvazione. In
particolare React Router 8 non deve essere aperto come bump parziale: SyncBay
usa il preset `@vercel/react-router` e la versione `1.3.2` dichiara peer su
React Router 7. La migrazione a React Router 8 va quindi fatta in una branch
dedicata aggiornando insieme `react-router`, i pacchetti `@react-router/*` e il
preset Vercel solo quando esiste una versione compatibile.

Finché SyncBay resta su React Router 7 con Vite 8, `@react-router/dev@7.18.2`
è patchato con `patch-package` perché la sua configurazione vite-node interna
usa ancora l'opzione deprecata `envFile: false`. La patch versionata in
`patches/@react-router+dev+7.18.2.patch` sostituisce quell'opzione con
`envDir: false` e viene riapplicata da `postinstall`. `patch-package` vive in
`devDependencies`: senza il percorso Docker non esiste più un install
`--omit=dev` che debba eseguire `postinstall`. Rimuovere la patch solo insieme
a una migrazione verificata a una release React Router/preset Vercel che non
emetta più quel warning.

Prisma è aggiornato a 7.9.1 con `prisma.config.ts`, generator di compatibilità
`prisma-client-js`, output `prisma/generated/client` ignorato da Git e link
post-generate verso il path atteso da `@prisma/client`. Questa scelta mantiene
compatibili il test runner Node nativo e il template React Router finché il
client `prisma-client` TypeScript non sarà adottabile senza loader dedicati. Il
runtime usa `@prisma/adapter-pg`; lo storage sessioni Shopify è locale perché
`@shopify/shopify-app-session-storage-prisma` non dichiara ancora compatibilità
con Prisma 7. Future major Prisma restano manuali.

I tipi Node oltre la major del runtime dichiarato richiedono un pass manuale:
il runtime repo resta `>=24.15 <25`.

Knip cerca file, export e dipendenze non usati. È risolto via `npx` e non vive
in `devDependencies`; la major è pinnata perché `knip.json` ne segue lo schema.
È uno strumento advisory e manuale, non un gate: non entra in
`verify:changed` né in `verify:full`. La configurazione dichiara come entry i
file che Knip non può raggiungere perché referenziati via stringa (config Vite e
stub del render UI) e ignora i binari di sistema `psql`, `security` e `vercel`.
`ignoreExportsUsedInFile` tiene il report sul codice davvero morto: senza,
segnala anche i simboli usati solo nel proprio file, che sono over-export
innocui e non una segnalazione azionabile. Gli export che esistono solo come
asserzione di compile-time sulla copertura degli enum Prisma (`*CoverPrisma`)
sono marcati `@knipignore`: non hanno importatori per costruzione e non vanno
cancellati.

React Doctor segue due corsie entrambe bloccanti dai warning in su: il gate
generale esegue `npm run doctor` dalla dipendenza pinnata e il workflow dedicato
usa l'Action ufficiale fissata a una revisione verificata, pubblica score e
review inline su ogni PR e ripete la scansione completa dopo il push a `main`.
L'unica esclusione di regola riguarda `app/routes/app.tsx`: React Router impone
nello stesso route-module gli export `loader`, `headers` ed `ErrorBoundary`,
quindi `only-export-components` è un falso positivo dimostrato. Il controllo
supply-chain esterno è disabilitato perché audit npm e GitHub coprono già le
dipendenze.

## Comandi locali

| Scopo                          | Comando                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Installazione                  | `npm install --global npm@12.0.2` al primo setup, poi `npm install`                                              |
| Sviluppo Shopify               | `npm run dev`                                                                                                    |
| Typecheck                      | `npm run typecheck`                                                                                              |
| Lint (oxlint)                  | `npm run lint`                                                                                                   |
| Formattazione oxfmt            | `npm run format` (applica) / `npm run format:check` (verifica)                                                   |
| Build                          | `npm run build`                                                                                                  |
| Smoke UI                       | `npm run smoke:ui`                                                                                               |
| Smoke deployment Production    | `npm run smoke:production`                                                                                       |
| Render UI fixture isolato      | `npm run ui:check`                                                                                               |
| Browser UI fixture isolato     | `npm run ui:browser-check`                                                                                       |
| Misura performance loader      | `npm run perf:loaders -- --since 10m`                                                                            |
| Screenshot UI Admin live       | `npm run ui:shot-live -- [VoceNav] [nome-output]`                                                                |
| Test librerie pure             | `npm run test:lib`                                                                                               |
| Test servizi server            | `npm run test:services`                                                                                          |
| Test runtime completo          | `npm run test:runtime`                                                                                           |
| Coverage moduli puri           | `npm run coverage:lib`                                                                                           |
| Audit produzione               | `npm run audit:prod`                                                                                             |
| Generazione Prisma             | `npm run prisma:generate`                                                                                        |
| Validazione Prisma             | `npm run prisma:validate`                                                                                        |
| Advisor Supabase               | `npm run db:verify`                                                                                              |
| Servizi HTTP Supabase          | `npm run supabase:services`                                                                                      |
| Doctor locale                  | `npm run doctor:local`                                                                                           |
| Creazione worktree             | `npm run worktree:create -- --branch codex/<tema> [--base origin/main] [--dry-run]`                              |
| Ripresa setup worktree         | `npm run worktree:prepare`                                                                                       |
| Self-review pre-PR             | `npm run review:pre-pr -- --base origin/main`                                                                    |
| Preflight pubblicazione        | `npm run publish:preflight -- --remote`                                                                          |
| Pubblicazione completa PR      | `npm run publish:complete [-- --pr <numero>]`                                                                    |
| Verifica automatica del diff   | `npm run verify:changed -- --base origin/main`                                                                   |
| Verifica runtime completa      | `npm run verify:full [-- --force]`                                                                               |
| Verifica pubblicazione         | `npm run verify:publish -- --remote`                                                                             |
| Diagnostica job import         | `npm run jobs:status -- --shop <shop.myshopify.com>`                                                             |
| Budget egress Supabase         | `npm run egress:budget -- --budget-gb 5`                                                                         |
| Budget storage database        | `npm run db:storage-budget`                                                                                      |
| Budget Supabase Storage        | `npm run storage:budget`                                                                                         |
| Budget provider aggregato      | `npm run provider:budget`                                                                                        |
| Budget bundle                  | `npm run bundle:budget`                                                                                          |
| Verifica documentazione        | `npm run docs:check`                                                                                             |
| Maintenance storia prodotto    | `npm run history:maintain -- --dry-run`                                                                          |
| Archivio job storici           | `npm run jobs:archive-stale-failures -- --shop <shop.myshopify.com> --apply`                                     |
| Doctor conflitti/stale         | `npm run conflicts:doctor -- --shop <shop.myshopify.com>`                                                        |
| Limiti eBay Trading            | `npm run ebay:rate-limits -- --shop <shop.myshopify.com>`                                                        |
| Readiness ordini pagati        | `npm run orders:paid-readiness -- --shop <shop.myshopify.com>`                                                   |
| Verifica campione import       | `npm run import:verify -- --shop <shop.myshopify.com> --sample 10`                                               |
| Report pulizia descrizioni     | `npm run descriptions:cleanup-report -- --shop <shop.myshopify.com> --sample 20`                                 |
| Ripristino stock eBay          | `npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write`                      |
| Orfani categoria negozio       | `npm run ebay:store-category-orphans -- --shop <shop.myshopify.com> [--limit N]`                                 |
| Dry-run categorie              | `npm run categories:backfill -- --shop <shop.myshopify.com> [--limit N]`                                         |
| Backfill descrizioni pulite    | `npm run descriptions:backfill-cleanup -- --shop <shop.myshopify.com> [--limit N]`                               |
| Dry-run faccette storefront    | `npm run facets:backfill -- --shop <shop.myshopify.com> [--limit N]`                                             |
| Doctor collezioni              | `npm run collections:doctor -- --shop <shop.myshopify.com> [--intent-file f.json] [--json] [--limit-products N]` |
| Diagnostica immagini Catalogo  | `npm run catalog:images:doctor -- --shop <shop.myshopify.com> [--limit N]`                                       |
| Test guardia stock eBay        | `npm run test:stock-guard`                                                                                       |
| Test script e workflow         | `npm run test:tooling`                                                                                           |
| React Doctor                   | `npm run doctor`                                                                                                 |
| Codice morto ed export inutili | `npm run quality:knip`                                                                                           |
| Release dry-run                | `npm run release:dry-run`                                                                                        |
| Release locale                 | `npm run release`                                                                                                |

Per prerequisiti, guardie e modalità apply dei comandi operativi usa la guida
[`guides/comandi-manutenzione.md`](guides/comandi-manutenzione.md). Aprila solo
quando il task riguarda diagnostica o manutenzione live.

### Copertura dei moduli server

La copertura reale si ricava dai test presenti, non da un inventario manuale.
Quando cambia un modulo `app/services`, aggiungi o aggiorna un test server o di
contratto proporzionato al rischio ed esegui `npm run test:runtime`.

`npm run build` esegue `npm run prisma:generate` tramite `prebuild`, mantenendo
il Prisma Client allineato allo schema anche nei deploy con cache installazione.

Vitest è l'unico runner di test del repository: un'unica `vitest.config.ts`
raccoglie i test applicativi (`app/**/*.test.ts`) e quelli tooling
(`scripts/*.test.mjs`, `.github/scripts/*.test.mjs`), e ogni corsia è un filtro
di percorso (`vitest run app/lib`, `vitest run app/services`,
`vitest run scripts/`). Non resta alcun test su `node --test` o `tsx --test`.
L'auto-discovery elimina il gap dei glob per cui i test fuori pattern andavano
lanciati a mano, e la risoluzione TypeScript di Vitest rimuove il vincolo sui
value-import cross-lib che rompeva il vecchio `node --test`.

`testTimeout` è alzato a 60s perché i test tooling lanciano subprocess per
fixture: il più lento impiega circa 15 secondi, mentre `node --test` non
applicava alcun timeout.

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

Dopo `git worktree add`, il setup usa npm `12.0.2` via `npx`, poi esegue in serie
l'installazione, una sola generazione Prisma, doctor locale, test delle librerie e
test dei servizi raw; alla fine richiede un checkout pulito. Se uno step
fallisce, la worktree viene lasciata ispezionabile e il setup si riprende al suo
interno con `npm run worktree:prepare`, senza una seconda creazione o retry
ciechi.

## Verifiche per tipo di modifica

| Tipo modifica                                                               | Verifiche proporzionate                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Docs-only                                                                   | Review contenuto e `npm run verify:changed -- --base origin/main`                                                            |
| Pre-PR non banale                                                           | `npm run review:pre-pr -- --base origin/main`, chiusura dei punti emersi, poi `npm run verify:changed -- --base origin/main` |
| Runtime TypeScript/UI ordinario                                             | `npm run verify:changed -- --base origin/main`; aggiungere verifica browser quando cambia il comportamento visibile          |
| Moduli `app/services`, runtime condiviso o CI                               | `npm run verify:full -- --force`; aggiungere test mirati prima del gate completo                                             |
| Moduli puri `app/lib`                                                       | test del file durante l'iterazione, poi `npm run verify:changed -- --base origin/main`                                       |
| Pubblicazione/merge PR                                                      | `npm run verify:publish -- --remote`; aggiungere `npm run conflicts:doctor` quando il lavoro tocca conflitti, stale o retry  |
| Qualità React dopo release major/minor o cambi UI/React trasversali         | `npm run doctor`, dalla versione esatta fissata nel lockfile                                                                 |
| Refactor che rimuovono consumatori, ritiri di funzionalità o consolidamenti | `npm run quality:knip`, che rileva file ed export rimasti senza consumatori                                                  |
| Flussi UI principali                                                        | `npm run smoke:ui` quando il dev server o lo script sono applicabili                                                         |
| Prisma/database                                                             | `npm run prisma:validate`, `npm run audit:prod`; `npm run db:verify` se Supabase linked è disponibile                        |
| Guardia stock eBay, valuta o dry-run                                        | `npm run test:stock-guard`; poi `npm run typecheck`, `npm run lint`, `npm run build`                                         |
| Versioning/changelog runtime                                                | `npm run release:dry-run`                                                                                                    |

La CI PR mantiene un unico job conclusivo: per diff docs-only esegue
`npm run format:check`, `npm run doctor` e `git diff --check`; per gli altri
diff esegue `verify:changed -- --no-receipt`, che include sempre React Doctor e
poi soltanto test, typecheck, lint, build e smoke dedotti dalle superfici
toccate. Il workflow dedicato duplica intenzionalmente React Doctor per
produrre review inline e uno status `react-doctor` richiesto separatamente.

Un check che blocca il merge deve essere funzione del diff in revisione. `npm
run audit:prod` non lo è: dipende dal database advisory, che cambia da solo,
quindi una vulnerabilità pubblicata a monte renderebbe rossa ogni PR aperta,
docs-only comprese, per una causa che l'autore non può risolvere nel proprio
scope. Sta quindi tra i gate advisory: il workflow `Audit produzione` lo esegue
ogni giorno e sulle PR che toccano dipendenze o lo script stesso, mentre resta
obbligatorio in locale dentro `verify:changed` e `verify:full`. Il segnale
resta, il merge non è più accoppiato.

Le advisory che non possono essere chiuse si registrano in
`ACCEPTED_ADVISORIES` (`scripts/syncbay-audit-prod.mjs`), con identificativo
GHSA, motivo e condizione di revisione. La waiver vale per quello specifico
advisory e non per il pacchetto: una vulnerabilità nuova sullo stesso pacchetto
fa fallire di nuovo il gate. Le voci accettate vengono stampate a ogni
esecuzione riuscita, così restano una decisione visibile invece di un buco
silenzioso. Un gate perennemente rosso smette di essere letto: l'accettazione
esplicita serve a mantenerlo credibile, non a nascondere il problema.

`npm run format:check` gira su ogni corsia, docs inclusa: oxfmt formatta anche
Markdown, CSS e TOML oltre a JS/TS, quindi il drift può entrare da qualunque
diff e nessun altro gate lo intercetterebbe. È il controllo più economico
(oxfmt processa l'intero repo in ~1,3 secondi) ed è messo per primo, così un
problema banale fallisce subito. oxfmt rispetta `.gitignore` nativamente, quindi
non serve un file di ignore dedicato. Nota di copertura: oxfmt non formatta i
`.json` (a differenza di Prettier); il drift di formattazione JSON non è più
intercettato da questo gate.

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
