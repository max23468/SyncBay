# Struttura repository

Questa struttura include documentazione di fondazione e scaffold applicativo Shopify CLI React Router.

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
  scripts/
    release.mjs
  shopify.app.toml
  tsconfig.json
  vite.config.ts
  app/
    lib/
    services/
    routes/
  extensions/
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
  docs/
    INDEX.md
    ROADMAP.md
    BACKLOG.md
    CONTEXT.md
    TOOLCHAIN.md
    DECISIONS.md
    data-model.md
    DECISIONS_PENDING.md
    glossario.md
    syncbay-product-technical-plan.md
    structure.md
    decisions/
      template.md
      0001-stack.md
      0002-branding.md
      0003-git-pubblicazione-versioning.md
      0004-runtime-ci-release-future.md
      0005-runtime-infrastructure.md
      0006-versioning-runtime-locale.md
      0007-privacy-provvisoria-pilota.md
    guides/
      architettura.md
      git-e-pubblicazione.md
      onboarding-e-import.md
      pre-scaffold-checklist.md
      provisioning-runtime.md
      prerequisiti-account.md
      service-governance.md
      sicurezza-privacy.md
      sync-engine.md
      versioning-e-release.md
    market/
      shopify-ebay-app-benchmark.md
```

## Regola

Non creare ancora worker dedicati, consumer Supabase Queues, sync catalogo o cartelle applicative ulteriori fuori dallo scaffold senza decisione esplicita.
