# Documentazione di SyncBay

Questa cartella raccoglie la documentazione approfondita del progetto.

SyncBay ha lo scaffold Shopify CLI React Router iniziale. La documentazione resta la fonte principale per decidere cosa costruire prima di aggiungere sync, worker o integrazioni eBay reali.

## Struttura

```text
.github/
  ISSUE_TEMPLATE/
  PULL_REQUEST_TEMPLATE.md
app/
  routes/
prisma/
  schema.prisma
supabase/
  config.toml
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
      0005-runtime-infrastructure.md
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

## Quando consultare cosa

| Vuoi... | Vai a... |
| --- | --- |
| Capire in 2 minuti il progetto | `context.md` |
| Capire perimetro, MVP e fasi | `syncbay-product-technical-plan.md` |
| Vedere cosa fare ora e dopo | `../ROADMAP.md` |
| Capire identita, tono e visual direction | `../BRAND.md` |
| Capire la struttura docs/repo | `structure.md` |
| Consultare decisioni stabili | `decisions/` |
| Consultare decisioni ancora aperte | `decisions-pending.md` |
| Capire lo stack scelto | `decisions/0001-stack.md` |
| Capire infrastruttura runtime MVP | `decisions/0005-runtime-infrastructure.md` |
| Capire architettura proposta | `guides/architettura.md` |
| Preparare lo scaffold senza saltare passaggi | `guides/pre-scaffold-checklist.md` |
| Capire provisioning Vercel/Supabase | `guides/provisioning-runtime.md` |
| Chiudere prerequisiti account Shopify/eBay | `guides/prerequisiti-account.md` |
| Capire import e onboarding | `guides/onboarding-e-import.md` |
| Capire sync, stock e conflitti | `guides/sync-engine.md` |
| Capire limiti e governance del servizio | `guides/service-governance.md` |
| Capire dati e entita | `data-model.md` |
| Capire sicurezza e privacy | `guides/sicurezza-privacy.md` |
| Capire policy Git/PR/pubblicazione | `guides/git-e-pubblicazione.md` |
| Capire versioning e release | `guides/versioning-e-release.md` |
| Capire runtime/CI/release futuri | `decisions/0004-runtime-ci-release-future.md` |
| Usare termini coerenti in UI/docs | `glossario.md` |
| Capire competitor e differenziazione | `market/shopify-ebay-app-benchmark.md` |

## Documentazione fuori da `docs/`

I file nella root sono punti d'ingresso convenzionali:

- `README.md`: orientamento rapido.
- `AGENTS.md`: regole operative per agenti e Codex.
- `BRAND.md`: identita, tono, tagline e visual direction.
- `ROADMAP.md`: priorita e backlog.
- `CHANGELOG.md`: storico modifiche significative.
- `SECURITY.md`: policy sicurezza root.
- `.env.example`: env var previste.

## Regola di manutenzione

Aggiorna la documentazione quando cambia una decisione stabile. Non creare file paralleli per lo stesso tema: integra il piano principale o crea un ADR mirato.

## Regola di handoff

Ogni chiusura di lavoro deve indicare prossimi passi concreti quando esiste un seguito operativo reale. Se il lavoro e chiuso e non c'e una prossima azione utile, dichiararlo esplicitamente.
