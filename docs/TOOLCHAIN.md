# Toolchain - SyncBay

Questo documento dichiara runtime, package manager, lockfile, tool e verifiche applicabili a SyncBay.

## Runtime locale

| Area | Valore |
| --- | --- |
| Runtime principale | Node.js |
| Versione locale preferita | `.node-version` = `24.16.0` |
| Range supportato | `package.json` `engines.node` = `>=24.15 <25` |
| Enforcement engine | `.npmrc` con `engine-strict=true` |
| Package manager | npm |
| Lockfile | `package-lock.json` |
| Immagine Docker base | `node:24.16.0-alpine` |

Il floor Node `>=24.15` è richiesto dalla catena `react-doctor@0.2.8` tramite `ini@7`; non abbassarlo senza cambiare strategia sul quality gate. La base Docker è pinnata a Node 24.16.0 per evitare drift sotto il floor richiesto da `.npmrc` con `engine-strict=true`.

## Stack applicativo

| Area | Tool |
| --- | --- |
| Shopify app | Shopify CLI `3.94.3` |
| Frontend/backend app | React Router, React, TypeScript, Vite |
| Hosting previsto | Vercel |
| Database | Supabase Postgres |
| ORM | Prisma |
| Queue e scheduler previsti | Supabase Queues e Supabase Cron |
| Storage immagini temporaneo | Supabase Storage privato |
| Osservabilità baseline | Vercel Web Analytics e Speed Insights |
| Quality React | React Doctor |

## Comandi locali

| Scopo | Comando |
| --- | --- |
| Installazione | `npm install` |
| Sviluppo Shopify | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Smoke UI | `npm run smoke:ui` |
| Validazione Prisma | `npm run prisma:validate` |
| Advisor Supabase | `npm run db:verify` |
| React Doctor | `npm run quality:react-doctor` |
| Release dry-run | `npm run release:dry-run` |
| Release locale | `npm run release` |

`npm run db:verify` richiede progetto Supabase linked e credenziali disponibili. Le migration remote vanno applicate esplicitamente con `npx prisma migrate deploy` o, se il pooler blocca Prisma, con la procedura documentata in `docs/guides/provisioning-runtime.md`.
`npm run build` esegue sempre `prisma generate` tramite `prebuild`, per mantenere il Prisma Client allineato allo schema anche nei deploy Vercel con cache installazione.

## Verifiche per tipo di modifica

| Tipo modifica | Verifiche proporzionate |
| --- | --- |
| Docs-only | Review contenuto e `git diff --check` |
| Runtime TypeScript/UI | `npm run typecheck`, `npm run lint`, `npm run build` |
| Qualità React dopo cambi UI/React | `npm run quality:react-doctor` |
| Flussi UI principali | `npm run smoke:ui` quando il dev server o lo script sono applicabili |
| Prisma/database | `npm run prisma:validate`; `npm run db:verify` se Supabase linked è disponibile |
| Versioning/changelog runtime | `npm run release:dry-run` |

## Deploy e release

SyncBay ha versioning locale, un deployment pilota Vercel production e una
policy tag/GitHub Release per release prodotto reali. Non ha ancora una policy
di release pubblica Shopify App Store.

- `pubblica` significa portare il lavoro su GitHub/main secondo `docs/guides/git-e-pubblicazione.md`.
- `rilascia` significa usare il flusso locale `npm run release`.
- `deploya` significa aggiornare il deployment pilota Vercel production e
  verificarlo; non implica App Store, billing, tag o GitHub Release.
- tag e GitHub Release si creano solo per release prodotto reali secondo ADR
  `docs/decisions/0008-tag-e-github-release.md`.
