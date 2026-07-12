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
| Immagine Docker base      | `node:24.18.0-alpine`                         |

Il floor Node `>=24.15` è richiesto dalla catena React Doctor tramite `ini@7`;
non abbassarlo senza cambiare strategia sul quality gate. La base Docker è
pinnata a Node 24.18.0 per evitare drift sotto il floor richiesto da `.npmrc`
con `engine-strict=true`. Il package manager canonico è dichiarato in
`package.json` come `npm@11.17.0`.

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
`envDir: false` e viene riapplicata da `postinstall`. `patch-package` resta in
`dependencies` perché `npm ci --omit=dev` esegue comunque `postinstall` nel
Dockerfile. Rimuovere la patch solo insieme a una migrazione verificata a una
release React Router/preset Vercel che non emetta più quel warning.

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

## Tool agenti Shopify

Per sviluppo assistito su superfici Shopify, questa postazione può usare anche
il plugin Shopify disponibile in Codex Desktop per questo tool e per questa
repo. Il plugin va considerato un supporto operativo per documentazione,
validazione e contesto Shopify, non una dipendenza runtime di SyncBay.

La postazione locale può inoltre usare Shopify AI Toolkit installato come skill
globali dell'agente:

- installazione: `npx skills add Shopify/shopify-ai-toolkit`;
- skill attese: `shopify-admin`, `shopify-use-shopify-cli`,
  `shopify-polaris-app-home`, `shopify-app-store-review`, `shopify-dev` e le
  altre skill Shopify installate dal toolkit;
- Dev MCP Shopify opzionale: `shopify-dev-mcp` via `npx -y @shopify/dev-mcp@latest`
  nella configurazione locale Codex.

Questi tool non sono dipendenze runtime di SyncBay e non sostituiscono ADR,
documentazione del progetto o verifiche locali. Le skill installate manualmente
non si aggiornano da sole: prima di usarle per decisioni sensibili su API,
App Store, compliance o CLI, verifica la documentazione Shopify corrente.

## Tool agenti memoria

Questa postazione può usare `mex-agent` come scaffold di memoria locale per
Codex, Claude Code e altri agenti. Lo scaffold vive in `.mex/`, ignorata da
Git, ed è una memoria operativa routata, non una dipendenza runtime di SyncBay.

Regole d'uso:

- Codex e Claude Code devono leggere prima `AGENTS.md`; poi, se presente, usare
  `.mex/ROUTER.md` per aprire solo i file `context/` e `patterns/` pertinenti.
- Le fonti canoniche restano `AGENTS.md`, `docs/INDEX.md`, ADR e documentazione
  in `docs/`; se mex è in conflitto, va considerato stale.
- Usare `npx mex-agent check --quiet` per un controllo rapido e
  `npx mex-agent sync --dry-run` per preparare un aggiornamento mirato.
- Non committare `.mex/telemetry-id`, segreti, output locali o dati reali.

## Comandi locali

| Scopo                         | Comando                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Installazione                 | `npm install`                                                                               |
| Sviluppo Shopify              | `npm run dev`                                                                               |
| Typecheck                     | `npm run typecheck`                                                                         |
| Lint                          | `npm run lint`                                                                              |
| Build                         | `npm run build`                                                                             |
| Smoke UI                      | `npm run smoke:ui`                                                                          |
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
| Self-review pre-PR            | `npm run review:pre-pr -- --base origin/main`                                               |
| Preflight pubblicazione       | `npm run publish:preflight -- --remote`                                                     |
| Diagnostica job import        | `npm run jobs:status -- --shop <shop.myshopify.com>`                                   |
| Budget egress Supabase        | `npm run egress:budget -- --budget-gb 5`                                                    |
| Budget storage database       | `npm run db:storage-budget`                                                                 |
| Budget provider aggregato     | `npm run provider:budget`                                                                   |
| Backfill baseline prodotto    | `npm run product-baselines:backfill -- --dry-run`                                           |
| Maintenance storia prodotto  | `npm run history:maintain -- --dry-run`                                                     |
| Archivio job storici          | `npm run jobs:archive-stale-failures -- --shop <shop.myshopify.com> --apply`           |
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
| React Doctor                  | `npm run quality:react-doctor`                                                              |
| Release dry-run               | `npm run release:dry-run`                                                                   |
| Release locale                | `npm run release`                                                                           |

Per prerequisiti, guardie e modalità apply dei comandi operativi usa la guida
[`guides/comandi-manutenzione.md`](guides/comandi-manutenzione.md). Aprila solo
quando il task riguarda diagnostica o manutenzione live.

### Copertura dei moduli server

Il censimento distingue test diretto, contratto coperto da test puri/route e
adapter banale. “Contratto coperto” non equivale a coverage diretta dell'I/O:
quando uno di questi moduli ad alto rischio viene modificato, il relativo task
deve aggiungere un test server o un test di contratto esplicito.

| Modulo `app/services` | Classificazione attuale | Evidenza o requisito |
| --- | --- | --- |
| `crypto.server.ts` | Contratto coperto | Cifratura/token coperti dai test puri; test server obbligatorio nel Task 5 |
| `ebay-account-deletion.server.ts` | Contratto coperto | Deduplica, verifica e retention account deletion nei test `app/lib` |
| `ebay-environment.server.ts` | Adapter banale | Selezione configurazione ambiente senza regole di dominio |
| `ebay-inventory-preview.server.ts` | Contratto coperto | Modalità e finestra preview nei test `app/lib`; adapter I/O da testare se modificato |
| `ebay-notifications.server.ts` | Contratto coperto | Firma/deduplica account deletion nei test `app/lib` |
| `ebay-token.server.ts` | Contratto coperto | Envelope/rate limit/cifratura nei test puri; test server obbligatorio se cambia refresh |
| `ebay-trading-preview.server.ts` | Test diretto | `ebay-trading-preview.server.test.ts` |
| `ebay-trading-stock.server.ts` | Contratto coperto | Guardie stock, valuta, allowlist e idempotenza nei test `app/lib` |
| `ebay.server.ts` | Contratto coperto | Circuit breaker e rate limit nei test `app/lib`; adapter HTTP da testare se modificato |
| `import-preview.server.ts` | Contratto coperto | Mode/window/stepper/takeover nei test `app/lib` |
| `pricing-rules.server.ts` | Contratto coperto | Calcolo, normalizzazione e write decision nei test pricing puri |
| `retention-cleanup.server.ts` | Contratto coperto | Piano e cutoff retention nei test `app/lib` |
| `shopify-admin-session.server.ts` | Contratto coperto | Client Admin e diagnostica nei test `app/lib`; test server obbligatorio nel Task 6 |
| `shopify-draft-import.server.ts` | Contratto coperto | Contratti import, pricing, snapshot, media e pubblicazione nei test `app/lib` |
| `shopify-existing-products.server.ts` | Test diretto | `shopify-existing-products.server.test.ts` |
| `shopify-location.server.ts` | Contratto coperto | Scope e diagnostica location nei test `app/lib` |
| `shopify-prisma-session-storage.server.ts` | Test diretto | `shopify-prisma-session-storage.server.test.ts` |
| `sync-job-runner.server.ts` | Contratto coperto | Fairness/deadline, scheduling, batching, idempotenza, retry e guardie stock coperti dai test `app/lib` e dal test server del rilevamento conflitti |
| `shopify-conflict-detection.server.ts` | Test diretto | Porte batch, isolamento errori, mapping mancanti, stati mapping e lettura Shopify unica in `shopify-conflict-detection.server.test.ts` |
| `syncbay-product-facets.server.ts` | Contratto coperto | Proposta, baseline, sync plan e backfill faccette nei test `app/lib` |
| `syncbay.server.ts` | Contratto coperto | Contratti catalogo/conflitti/snapshot/audit nei test `app/lib`; nuovi verticali richiedono test server |
`npm run build` esegue sempre `npm run prisma:generate` tramite `prebuild`, per mantenere il Prisma Client allineato allo schema anche nei deploy Vercel con cache installazione.

## Verifiche per tipo di modifica

| Tipo modifica                                                       | Verifiche proporzionate                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docs-only                                                           | Review contenuto e `git diff --check`                                                                                                                  |
| Pre-PR non banale                                                   | `npm run review:pre-pr -- --base origin/main`, poi chiusura dei punti emersi e verifiche proporzionate al diff                                        |
| Runtime TypeScript/UI                                               | `npm run typecheck`, `npm run lint`, `npm run build`                                                                                                   |
| Moduli `app/services` o CI runtime                                  | `npm run test:runtime`, poi `npm run coverage:lib`, `npm run typecheck`, `npm run lint`                                                                |
| Moduli puri `app/lib` o audit coverage SyncBay                      | `npm run test:lib`, `npm run coverage:lib`, poi `npm run typecheck`, `npm run lint` quando pertinenti                                                  |
| Pubblicazione/merge PR                                              | `npm run doctor:local`, `npm run publish:preflight -- --remote`; aggiungere `npm run conflicts:doctor` quando il lavoro tocca conflitti, stale o retry |
| Qualità React dopo release major/minor o cambi UI/React trasversali | `npm run quality:react-doctor` con la dev dependency locale `react-doctor`                                                                             |
| Flussi UI principali                                                | `npm run smoke:ui` quando il dev server o lo script sono applicabili                                                                                   |
| Prisma/database                                                     | `npm run prisma:validate`, `npm run audit:prod`; `npm run db:verify` se Supabase linked è disponibile                                                 |
| Guardia stock eBay, valuta o dry-run                                | `npm run test:stock-guard`; poi `npm run typecheck`, `npm run lint`, `npm run build`                                                                   |
| Versioning/changelog runtime                                        | `npm run release:dry-run`                                                                                                                              |

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
