# Indice documentale - SyncBay

Questa cartella raccoglie la documentazione approfondita del progetto.

SyncBay ha lo scaffold Shopify CLI React Router e una custom app privata 1.0
con import, runner, sync, conflitti, catalogo esistente e integrazioni
Shopify/eBay nel perimetro 1.0 già implementati. La documentazione resta la fonte principale per decidere cosa
estendere prima di aggiungere nuovi runtime, nuove integrazioni provider o
superfici fuori dal perimetro approvato.

La struttura del repository è descritta una sola volta in
[`structure.md`](structure.md); questo file serve esclusivamente da indice per
intento.

## Quando consultare cosa

| Vuoi...                                                                   | Vai a...                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Capire in 2 minuti il progetto                                            | `CONTEXT.md`                                                        |
| Capire perimetro, 1.0 privata e fasi                                      | `syncbay-product-technical-plan.md`                                 |
| Vedere cosa fare ora e dopo                                               | `ROADMAP.md`                                                        |
| Consultare lo storico esteso della vecchia roadmap                        | `ROADMAP_HISTORY.md`                                                |
| Vedere idee e debiti non ancora promossi                                  | `BACKLOG.md`                                                        |
| Capire runtime, tool e verifiche                                          | `TOOLCHAIN.md`                                                      |
| Usare comandi di diagnostica o manutenzione live                          | `guides/comandi-manutenzione.md`                                    |
| Verificare integrazione Doppler e segreti CI                              | `doppler-setup.md`                                                  |
| Capire identità, tono e visual direction                                  | `../BRAND.md`                                                       |
| Capire la struttura docs/repo                                             | `structure.md`                                                      |
| Consultare decisioni stabili                                              | `DECISIONS.md`                                                      |
| Consultare decisioni ancora aperte                                        | `DECISIONS_PENDING.md`                                              |
| Capire lo stack scelto                                                    | `decisions/0001-stack.md`                                           |
| Capire infrastruttura runtime                                             | `decisions/0005-runtime-infrastructure.md`                          |
| Capire versioning runtime locale                                          | `decisions/0006-versioning-runtime-locale.md`                       |
| Capire tag e GitHub Release                                               | `decisions/0008-tag-e-github-release.md`                            |
| Capire token offline Shopify a scadenza                                   | `decisions/0009-shopify-token-offline-a-scadenza.md`                |
| Capire retention dati operativi                                           | `decisions/0017-retention-dati-operativi.md`                        |
| Capire cleanup retention automatico                                       | `decisions/0018-cleanup-retention-automatico.md`                    |
| Capire cadenza Supabase Cron del runner                                   | `decisions/0019-cadenza-cron-runner.md`                             |
| Capire perimetro e go-live 1.0 custom privata                             | `decisions/0020-1-0-custom-privata-catalogo-esistente.md`           |
| Capire architettura proposta                                              | `guides/architettura.md`                                            |
| Preparare lo scaffold senza saltare passaggi                              | `guides/pre-scaffold-checklist.md`                                  |
| Capire provisioning Vercel/Supabase                                       | `guides/provisioning-runtime.md`                                    |
| Chiudere prerequisiti account Shopify/eBay                                | `guides/prerequisiti-account.md`                                    |
| Capire import e onboarding                                                | `guides/onboarding-e-import.md`                                     |
| Preparare il mini kit clienti selezionati 1.0                             | `guides/onboarding-e-import.md`                                     |
| Capire sync, stock e conflitti                                            | `guides/sync-engine.md`                                             |
| Recuperare decisioni, concept UI e fonti archiviate del redesign embedded | `guides/ui-concepts-handoff.md`                                     |
| Consultare piani e specifiche storiche                                    | `superpowers/README.md`                                             |
| Consultare il piano completo di miglioramento                             | `superpowers/plans/2026-07-10-syncbay-comprehensive-improvement.md` |
| Capire limiti e governance del servizio                                   | `guides/service-governance.md`                                      |
| Capire dati e entità                                                      | `data-model.md`                                                     |
| Capire sicurezza e privacy                                                | `guides/sicurezza-privacy.md`                                       |
| Capire policy Git/PR/pubblicazione                                        | `guides/git-e-pubblicazione.md`                                     |
| Capire versioning e release                                               | `guides/versioning-e-release.md`                                    |
| Capire runtime/CI/release futuri                                          | `decisions/0004-runtime-ci-release-future.md`                       |
| Usare termini coerenti in UI/docs                                         | `glossario.md`                                                      |
| Capire competitor e differenziazione                                      | `market/shopify-ebay-app-benchmark.md`                              |

## Documentazione fuori da `docs/`

I file nella root sono punti d'ingresso convenzionali:

- `README.md`: orientamento rapido.
- `AGENTS.md`: regole operative per agenti e Codex.
- `BRAND.md`: identità, tono, tagline e visual direction.
- `CHANGELOG.md`: storico modifiche significative.
- `SECURITY.md`: policy sicurezza root.
- `.env.example`: env var previste.

## Regola di manutenzione

Aggiorna la documentazione quando cambia una decisione stabile. Non creare file
paralleli per lo stesso tema: integra la fonte canonica o crea un ADR mirato.
