# Struttura documentale iniziale

Questa struttura serve solo a tenere ordinata la fase di piano. Non e ancora lo scaffold applicativo.

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
  ROADMAP.md
  CHANGELOG.md
  SECURITY.md
  .env.example
  .gitignore
  shopify.app.toml
  brand/
    README.md
    assets/
      favicon/
      manifest.json
      png/
      source/
      svg/
  docs/
    README.md
    context.md
    data-model.md
    decisions-pending.md
    glossario.md
    syncbay-product-technical-plan.md
    structure.md
    decisions/
      README.md
      template.md
      0001-stack.md
      0002-branding.md
      0003-git-pubblicazione-versioning.md
      0004-runtime-ci-release-future.md
    guides/
      architettura.md
      git-e-pubblicazione.md
      onboarding-e-import.md
      pre-scaffold-checklist.md
      prerequisiti-account.md
      service-governance.md
      sicurezza-privacy.md
      sync-engine.md
      versioning-e-release.md
    market/
      shopify-ebay-app-benchmark.md
```

## Regola

Finche non parte lo scaffold tecnico, evitare cartelle applicative come `app/`, `src/`, `prisma/`, `workers/` o `package.json`.

Queste verranno create solo quando il piano passa dalla fase documentale alla fase implementativa.
