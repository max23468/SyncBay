# Agent Workflow Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ridurre passaggi manuali, verifiche duplicate, falsi fallimenti e superfici Codex ridondanti senza indebolire i gate runtime di SyncBay.

**Architecture:** Un nuovo orchestratore Node senza dipendenze classifica il diff, esegue check seriali e salva ricevute locali legate allo stato Git, al lockfile e al runtime. La CI usa lo stesso classificatore per separare docs-only e runtime, mentre i comandi pubblici continuano a generare Prisma quando lanciati singolarmente. La configurazione Codex globale mantiene un'unica famiglia Vercel e Shopify, disabilita Linear e pinna Shopify Dev MCP.

**Tech Stack:** Node.js 24, npm 11, `node:test`, Git, GitHub Actions, TOML Codex.

## Global Constraints

- Non pubblicare, non aprire PR, non eseguire deploy o release.
- Eseguire i comandi di verifica in modo seriale nello stesso worktree.
- File o classi di modifica sconosciute ricadono nella corsia completa.
- Le ricevute non si applicano ai controlli remoti o live.
- Mantenere `vercel@openai-curated` e `shopify@openai-curated`; disabilitare solo le famiglie duplicate concordate.
- Lasciare invariati Neon, Cloudflare, GitHub e gli altri MCP non nominati.
- Non scomporre i tre grandi moduli runtime.

---

### Task 1: Orchestratore unico e ricevute locali

**Files:**

- Create: `scripts/syncbay-verify.mjs`
- Create: `scripts/syncbay-verify.test.mjs`
- Modify: `scripts/syncbay-pre-pr-self-review.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `buildPrePrSelfReview`, `parseNameStatusDiff`, `parseShortStatus`.
- Produces: `buildVerificationPlan({ mode, review })`, `createVerificationFingerprint(input)`, `runVerificationPlan(plan, options)` e CLI `changed|full|publish|classify`.

- [ ] **Step 1: Scrivere test failing per corsia docs-only, fallback full, deduplica, serialità e fingerprint**

  I test devono aspettarsi che `changed` docs-only esegua solo `git diff --check`, che file sconosciuti usino la corsia completa, che `full` contenga una sola generazione Prisma e non ripeta `test:lib`, e che il fingerprint cambi con diff, lockfile o Node.

- [ ] **Step 2: Eseguire il test e verificare RED**

  Run: `node --test scripts/syncbay-verify.test.mjs`
  Expected: FAIL perché `syncbay-verify.mjs` non esiste.

- [ ] **Step 3: Implementare il minimo orchestratore**

  Il CLI deve accettare `--base`, `--force`, `--no-receipt`, `--json`; eseguire con `spawnSync` un comando alla volta; saltare una verifica solo quando esiste una ricevuta `ok` con fingerprint identico; scrivere in `.cache/syncbay-verification/`; non memorizzare `publish`.

- [ ] **Step 4: Aggiungere script npm raw e pubblici**

  Aggiungere `build:raw`, `typecheck:raw`, `test:services:raw`, `verify:changed`, `verify:full`, `verify:publish`. Conservare `prebuild`, `pretypecheck` e `pretest:services` per la sicurezza dei comandi standalone.

- [ ] **Step 5: Verificare GREEN e regressioni pre-PR**

  Run: `node --test scripts/syncbay-verify.test.mjs scripts/syncbay-pre-pr-self-review.test.mjs`
  Expected: PASS.

- [ ] **Step 6: Commit locale**

  Run: `git add .gitignore package.json scripts/syncbay-verify.mjs scripts/syncbay-verify.test.mjs scripts/syncbay-pre-pr-self-review.mjs && git commit -m "feat: add state-aware verification runner"`

---

### Task 2: Doctor dei worktree e dipendenze generate

**Files:**

- Create: `scripts/syncbay-local-doctor.test.mjs`
- Modify: `scripts/syncbay-local-doctor.mjs`

**Interfaces:**

- Produces: `findTopLevelLockMismatches(rootLock, installedLock)`, `inspectPrismaClient(fsApi)` e campi report `dependenciesInstalled`, `lockfileAligned`, `prismaClientGenerated`, `prismaClientLinked`.

- [ ] **Step 1: Scrivere test failing per node_modules assente, lock mismatch e Prisma mancante**

  Le fixture sintetiche devono verificare messaggi correttivi contenenti `npm install` o `npm run prisma:generate`, senza valori env.

- [ ] **Step 2: Eseguire il test e verificare RED**

  Run: `node --test scripts/syncbay-local-doctor.test.mjs`
  Expected: FAIL per export mancanti.

- [ ] **Step 3: Implementare controlli read-only**

  Confrontare le versioni top-level installate in `node_modules/.package-lock.json` con `package-lock.json`; verificare `prisma/generated/client/index.js` e il link `node_modules/.prisma/client/default`; non installare né generare automaticamente.

- [ ] **Step 4: Verificare GREEN e CLI reale**

  Run: `node --test scripts/syncbay-local-doctor.test.mjs && npm run doctor:local -- --json`
  Expected: PASS e `ok: true` nel worktree configurato.

- [ ] **Step 5: Commit locale**

  Run: `git add scripts/syncbay-local-doctor.mjs scripts/syncbay-local-doctor.test.mjs && git commit -m "fix: detect incomplete worktree setup"`

---

### Task 3: Preflight remoto direct-first

**Files:**

- Modify: `scripts/syncbay-publish-preflight.mjs`
- Modify: `scripts/syncbay-publish-preflight.test.mjs`

**Interfaces:**

- Produces: `loadCodexFeedback({ pr, publishedMainPreflight }, readers)`.

- [ ] **Step 1: Scrivere test failing sul numero di letture remote**

  Verificare che una PR con review thread leggibili non interroghi l'inbox, che review thread illeggibili usino l'inbox come fallback e che il controllo post-merge su `main` legga l'inbox.

- [ ] **Step 2: Eseguire il test e verificare RED**

  Run: `node --test scripts/syncbay-publish-preflight.test.mjs`
  Expected: FAIL perché `loadCodexFeedback` non esiste.

- [ ] **Step 3: Implementare la lettura direct-first**

  Leggere prima `reviewThreads` per la PR corrente; chiamare issue inbox solo come fallback o per post-merge senza PR. Mantenere il blocco su feedback non leggibile.

- [ ] **Step 4: Verificare GREEN**

  Run: `node --test scripts/syncbay-publish-preflight.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit locale**

  Run: `git add scripts/syncbay-publish-preflight.mjs scripts/syncbay-publish-preflight.test.mjs && git commit -m "perf: avoid duplicate Codex feedback reads"`

---

### Task 4: CI sensibile al diff e workflow ridotti

**Files:**

- Create: `scripts/syncbay-workflow-config.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/react-doctor.yml`
- Modify: `.github/workflows/doppler-check.yml`
- Modify: `.github/workflows/pr-title.yml`

**Interfaces:**

- Consumes: CLI `node scripts/syncbay-verify.mjs classify --base <ref>` e `npm run verify:full -- --no-receipt`.

- [ ] **Step 1: Scrivere test failing sui workflow**

  Verificare testualmente che CI abbia `fetch-depth: 0`, classificazione docs/runtime e un solo `verify:full`; che React Doctor abbia filtri path runtime; che Doppler abbia filtri path configurazione; che PR Title non usi `synchronize`.

- [ ] **Step 2: Eseguire il test e verificare RED**

  Run: `node --test scripts/syncbay-workflow-config.test.mjs`
  Expected: FAIL sulle configurazioni correnti.

- [ ] **Step 3: Implementare workflow minimali**

  CI deve mantenere un job sempre conclusivo: docs-only esegue `git diff --check`; runtime configura Node, esegue `npm ci` e `verify:full`. Su PR usare la base remota, su push `github.event.before`; base nulla ricade su full.

- [ ] **Step 4: Verificare GREEN**

  Run: `node --test scripts/syncbay-workflow-config.test.mjs scripts/syncbay-verify.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit locale**

  Run: `git add .github/workflows scripts/syncbay-workflow-config.test.mjs && git commit -m "ci: skip runtime gates for docs-only changes"`

---

### Task 5: Istruzioni agenti e mappa servizi

**Files:**

- Create: `app/services/AGENTS.md`
- Modify: `AGENTS.md`
- Modify: `docs/TOOLCHAIN.md`
- Modify: `docs/guides/git-e-pubblicazione.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Documents: stop condition, serialità, ricevute, nuovi comandi e ownership degli hotspot senza refactor.

- [ ] **Step 1: Aggiungere stop condition durevoli**

  Documentare: niente comandi concorrenti sulle stesse cache/generated files; secondo errore identico richiede nuova ipotesi; terzo retry cieco vietato; riallineamento dopo merge/rebase; ricevute riutilizzabili solo a fingerprint invariato.

- [ ] **Step 2: Aggiungere `app/services/AGENTS.md`**

  Mappare runner, sync engine, import e adapter Shopify; indicare invarianti, entry point e test mirati; vietare modifiche trasversali non richieste.

- [ ] **Step 3: Aggiornare toolchain e changelog non versionato**

  Documentare `verify:changed`, `verify:full`, `verify:publish`, comportamento delle ricevute e corsia CI docs-only. Inserire la voce in `[Non rilasciato] > Non versionato`.

- [ ] **Step 4: Verificare documentazione**

  Run: `git diff --check`
  Expected: exit 0.

- [ ] **Step 5: Commit locale**

  Run: `git add AGENTS.md app/services/AGENTS.md docs/TOOLCHAIN.md docs/guides/git-e-pubblicazione.md CHANGELOG.md docs/superpowers/plans/2026-07-12-agent-workflow-acceleration.md && git commit -m "docs: codify efficient agent verification"`

---

### Task 6: Configurazione Codex globale mirata

**Files:**

- Modify: `/Users/Matteo/.codex/config.toml`

**Interfaces:**

- Codex config: plugin `enabled`, MCP `enabled`, `[[skills.config]]`.

- [ ] **Step 1: Disabilitare famiglie duplicate senza cancellarle**

  Impostare `vercel-plugin@plugins-cli` e `linear@openai-curated` a `enabled = false`; mantenere `vercel@openai-curated` e `shopify@openai-curated` abilitati. Aggiungere un override `[[skills.config]]` con `enabled = false` per ogni skill personale `/Users/Matteo/.agents/skills/shopify-*/SKILL.md` che ha un equivalente nel plugin curato; lasciare `shopify-dev` personale disabilitato anch'esso perché il plugin e l'MCP coprono il routing Shopify.

- [ ] **Step 2: Pinnare Shopify Dev MCP**

  Sostituire `@shopify/dev-mcp@latest` con `@shopify/dev-mcp@1.14.2`, aggiungere `enabled = true` e un timeout startup esplicito di 30 secondi.

- [ ] **Step 3: Verificare sintassi e inventario**

  Run: `codex mcp list`
  Expected: Shopify Dev MCP abilitato e Linear assente/disabilitato; gli altri server invariati.

  Run: `codex --version`
  Expected: exit 0, che conferma il parsing della configurazione.

---

### Task 7: Gate finali e self-review

**Files:**

- Review: intero diff del branch e configurazione globale mirata.

- [ ] **Step 1: Eseguire test script mirati**

  Run: `node --test scripts/syncbay-verify.test.mjs scripts/syncbay-local-doctor.test.mjs scripts/syncbay-pre-pr-self-review.test.mjs scripts/syncbay-publish-preflight.test.mjs scripts/syncbay-workflow-config.test.mjs`
  Expected: PASS.

- [ ] **Step 2: Eseguire verifica completa una prima volta**

  Run: `npm run verify:full -- --force`
  Expected: PASS e ricevuta locale creata.

- [ ] **Step 3: Verificare riuso ricevuta**

  Run: `npm run verify:full`
  Expected: exit 0 senza rieseguire i gate e messaggio di ricevuta valida.

- [ ] **Step 4: Eseguire self-review e controlli Git**

  Run: `npm run review:pre-pr -- --base origin/main && git diff --check && git status --short --branch -uall`
  Expected: nessun errore; branch locale non pubblicato.

- [ ] **Step 5: Non pubblicare**

  Conservare branch e worktree locali; non eseguire push, PR, merge, deploy, release, tag o GitHub Release.
