# Safe Dependency Updates Implementation Plan

**Goal:** Aggiornare tutte le dipendenze SyncBay che risultano compatibili con Node 24 e con la catena React Router, Shopify, Prisma e Vercel attuale, lasciando fuori le migrazioni major.

**Architecture:** Il lavoro modifica solo manifest, lockfile, changelog e documentazione toolchain. Gli aggiornamenti entro la linea corrente vengono applicati insieme; Shopify CLI 4.4 e React Doctor 0.7 vengono mantenuti solo se installazione, audit e gate completi restano verdi.

**Tech Stack:** Node.js 24.18.0, npm 11, React Router 7, Shopify CLI, Prisma 7, TypeScript 6, ESLint 10, Vite 8.

## Global Constraints

- Mantenere Node nella linea `>=24.15 <25` e `@types/node` nella major 24.
- Non migrare React Router 7 a 8 finché `@vercel/react-router` 1.3.1 dichiara peer sulla major 7.
- Non migrare TypeScript 6 a 7 in questo lotto.
- Non modificare Prisma 7.8.0 o la patch versionata di React Router 7.18.1.
- Non creare commit, push, PR, release o deploy senza una richiesta esplicita del maintainer.

---

### Task 1: Aggiornare il lotto compatibile

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/TOOLCHAIN.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: i range Node/npm e i peer dependency correnti del repository.
- Produces: un grafo npm installabile e documentato senza cambio di framework o runtime.

- [x] **Step 1: Installare le versioni candidate esplicite**

Run:

```bash
npm install @shopify/cli@4.4.0 --save-exact \
  dotenv@^17.4.2 isbot@^5.2.0 \
  @eslint-react/eslint-plugin@^5.13.2 \
  @types/node@^24.13.3 \
  @typescript-eslint/eslint-plugin@^8.63.0 \
  @typescript-eslint/parser@^8.63.0 \
  prettier@^3.9.5 react-doctor@^0.7.3 vite@^8.1.4
```

Expected: installazione completata senza `ERESOLVE` e audit npm con zero vulnerabilità.

- [x] **Step 2: Verificare le versioni dirette risolte**

Run:

```bash
npm ls --depth=0
npm outdated --json
```

Expected: nessun pacchetto aggiornabile entro le linee mantenute; restano visibili solo React Router 8, TypeScript 7 e `@types/node` 26 come major escluse.

- [x] **Step 3: Aggiornare toolchain e changelog**

In `docs/TOOLCHAIN.md`, sostituire Shopify CLI `4.3.0` con `4.4.0` se il candidato supera i gate. In `CHANGELOG.md`, aggiungere sotto `[Non rilasciato]` una voce `Sotto il cofano` che elenca l'aggiornamento compatibile delle dipendenze senza dichiarare migrazioni major.

### Task 2: Verificare compatibilità e sicurezza

**Files:**

- Verify: `package.json`
- Verify: `package-lock.json`
- Verify: `docs/TOOLCHAIN.md`
- Verify: `CHANGELOG.md`

**Interfaces:**

- Consumes: il grafo aggiornato prodotto dal Task 1.
- Produces: evidenza fresca per installazione, static analysis, test, build, Prisma e qualità React.

- [x] **Step 1: Verificare installazione pulita e audit**

Run:

```bash
npm install
npm audit
npm run audit:prod
```

Expected: zero vulnerabilità e nessuna modifica inattesa al lockfile.

- [x] **Step 2: Eseguire i gate standard e completi pertinenti**

Run:

```bash
npm run typecheck
npm run lint
npm run test:lib
npm run coverage:lib
npm run build
npm run prisma:validate
npm run smoke:ui
npm run quality:react-doctor
```

Expected: tutti i comandi terminano con exit code 0. Se Shopify CLI 4.4.0 o React Doctor 0.7.3 introducono un errore specifico, ripristinare solo quel candidato alla versione più recente della linea precedente e ripetere l'intero gate.

- [x] **Step 3: Eseguire la self-review finale**

Run:

```bash
git diff --check
git diff -- package.json package-lock.json docs/TOOLCHAIN.md CHANGELOG.md
npm run release:dry-run
```

Expected: diff focalizzato, nessun errore di whitespace e classificazione release patch dal changelog; nessuna release viene eseguita in questo task.

### Task 3: Confermare le esclusioni major

**Files:**

- Verify: `package.json`
- Verify: `docs/TOOLCHAIN.md`

**Interfaces:**

- Consumes: metadata registry correnti.
- Produces: una lista esplicita degli update non applicati perché non sicuri come drop-in.

- [x] **Step 1: Ricontrollare i peer che bloccano React Router 8**

Run:

```bash
npm view @vercel/react-router@latest version peerDependencies --json
npm view @shopify/shopify-app-react-router@latest version peerDependencies --json
```

Expected: peer su React Router 7, quindi la major 8 resta una migrazione separata.

- [x] **Step 2: Ricontrollare le linee runtime escluse**

Run:

```bash
npm view typescript@latest version engines --json
npm view @types/node@latest version --json
```

Expected: TypeScript 7 e tipi Node 26 restano fuori dal lotto per cambio major e policy runtime Node 24.
