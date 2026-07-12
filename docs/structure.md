# Struttura repository

Questa struttura descrive le aree vive del repository. Non è un listing
esaustivo di ogni file: per l'elenco reale usa `rg --files`.

```text
SyncBay/
  .github/
    ISSUE_TEMPLATE/
    PULL_REQUEST_TEMPLATE.md
    dependabot.yml
    scripts/
    workflows/
  AGENTS.md
  BRAND.md
  README.md
  CHANGELOG.md
  SECURITY.md
  .env.example
  .gitignore
  .npmrc
  Dockerfile
  package-lock.json
  package.json
  shopify.web.toml
  scripts/
    release.mjs
    smoke-ui.mjs
    syncbay-*.mjs
    *.test.mjs
  shopify.app.toml
  tsconfig.json
  vite.config.ts
  app/
    components/
    lib/
    routes/
    services/
    styles/
    db.server.ts
    root.tsx
    shopify.server.ts
  preview/
    README.md
    polaris-preview.css
  prisma/
    migrations/
    schema.prisma
  supabase/
    config.toml
  brand/
    BRAND_ASSETS.md
    assets/
      favicon/
      manifest.json
      png/
      source/
      svg/
  public/
  docs/
    INDEX.md
    ROADMAP.md
    ROADMAP_HISTORY.md
    BACKLOG.md
    CONTEXT.md
    TOOLCHAIN.md
    DECISIONS.md
    data-model.md
    DECISIONS_PENDING.md
    glossario.md
    syncbay-product-technical-plan.md
    structure.md
    assets/
      ui-concepts/
        2026-06-03/
    decisions/
      template.md
      0001-stack.md
      0002-branding.md
      0003-git-pubblicazione-versioning.md
      0004-runtime-ci-release-future.md
      0005-runtime-infrastructure.md
      0006-versioning-runtime-locale.md
      0007-privacy-provvisoria-pilota.md
      0008-tag-e-github-release.md
      0009-shopify-token-offline-a-scadenza.md
      0010-ui-design-layer-e-marchi-terzi.md
      ...
    guides/
      architettura.md
      comandi-manutenzione.md
      git-e-pubblicazione.md
      onboarding-e-import.md
      pre-scaffold-checklist.md
      provisioning-runtime.md
      prerequisiti-account.md
      service-governance.md
      sicurezza-privacy.md
      sync-engine.md
      ui-concepts-handoff.md
      versioning-e-release.md
    market/
      shopify-ebay-app-benchmark.md
    superpowers/
      plans/
      specs/
```

## Aree operative

- `app/routes/`: route React Router embedded, webhook e endpoint HTTP interni.
- `app/services/`: adapter runtime verso Shopify, eBay, Prisma e runner job.
- `app/lib/`: moduli puri e testabili per regole SyncBay, diagnostica,
  trasformazioni, scheduling e UI state.
- `scripts/`: comandi operativi locali o collegati a provider; molti sono
  intentionally dry-run by default e documentati in `docs/TOOLCHAIN.md`.
- `preview/`: harness visuale locale per route reali e stand-in `s-*`; gli
  screenshot generati in `preview/shots/` sono ignorati da Git.
- `docs/superpowers/`: piani/spec storici utili come evidenza, non backlog
  operativo corrente.
- `brand/` e `public/`: asset sorgente e asset pubblici SyncBay.

## Regole

Non creare nuovi worker dedicati, nuovi runtime, nuove code esterne,
integrazioni provider fuori dal perimetro 1.0 già deciso o cartelle applicative
ulteriori fuori dallo scaffold senza decisione esplicita.

Non committare output generati, cache, sessioni browser, staging locali o
snapshot provider. In Git restano codice, schema, migration, fixture sintetiche
e documentazione.
