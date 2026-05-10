# Roadmap - SyncBay

Documento vivo. Ogni decisione di prodotto, tecnica o operativa che cambia perimetro, priorità o backlog deve confluire qui.

Riferimenti: `AGENTS.md`, `README.md`, `docs/syncbay-product-technical-plan.md`.

Legenda stato: Fatto | In corso | Da fare | Idea

---

## 0. Fondazioni progetto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Piano prodotto e tecnico | `docs/syncbay-product-technical-plan.md` |
| Fatto | Benchmark Shopify App Store | `docs/market/shopify-ebay-app-benchmark.md` |
| Fatto | Stack iniziale documentato | ADR `docs/decisions/0001-stack.md` |
| Fatto | Regole operative agenti | `AGENTS.md` |
| Fatto | Sistema documentale base | Roadmap, changelog, index, contesto, glossario, guide e data model concettuale |
| Fatto | Decisioni aperte e checklist pre-scaffold | `docs/decisions-pending.md`, `docs/guides/pre-scaffold-checklist.md` |
| Fatto | Governance servizio e security policy | `docs/guides/service-governance.md`, `SECURITY.md` |
| Fatto | Remote GitHub e branch policy iniziale | Repo privato `max23468/SyncBay`, branch policy provvisoria in `docs/guides/git-e-pubblicazione.md` |
| Fatto | Policy pubblicazione e versioning | ADR `docs/decisions/0003-git-pubblicazione-versioning.md`, guide Git e versioning aggiornate |
| Fatto | Automazioni GitHub pre-runtime | Dependabot per GitHub Actions e inbox commenti Codex su PR |
| Fatto | Policy runtime, CI e release futura | ADR `docs/decisions/0004-runtime-ci-release-future.md` |
| Fatto | Versioning runtime locale | `app/lib/version.ts`, `npm run release`, ADR `docs/decisions/0006-versioning-runtime-locale.md` |
| Fatto | Prerequisiti account definiti | Shopify/eBay documentati in `docs/guides/prerequisiti-account.md`; valori reali da confermare |
| Fatto | Decisioni tecniche bloccanti | Vercel + Supabase, Prisma, Supabase Queues/Cron/Storage in ADR `docs/decisions/0005-runtime-infrastructure.md` |
| Fatto | Provisioning minimo runtime | Vercel `syncbay` e Supabase `mgjcbuokppfnglsftsmi`, documentati in `docs/guides/provisioning-runtime.md` |
| Fatto | Scaffold Shopify CLI React Router | Runtime TypeScript con React Router, Prisma session storage, webhook uninstall/scopes update e dashboard embedded minima |
| Fatto | Adattamento scaffold a SyncBay | Dashboard SyncBay, schema Prisma iniziale, webhook placeholder e stato connessioni Shopify/eBay |
| Fatto | Baseline osservabilità e primitive Supabase | Vercel Analytics/Speed Insights nel root app; `pgmq`, `pg_cron`, coda `syncbay_jobs` e bucket `syncbay-import-staging` applicati su Supabase |
| Fatto | Modello mapping/snapshot/conflitti | Schema Prisma e migration applicati su Supabase; import reale ancora disabilitato |

## 1. Identità prodotto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Nome prodotto: SyncBay | Shopify app eBay-first |
| Fatto | Posizionamento eBay.it-first | Catalogo eBay.it come sorgente, Shopify come copia pulita |
| Fatto | Formula prodotto | "SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilità sincronizzate e meno rischio di vendere prodotti non disponibili." |
| Fatto | Tagline principale | "Dal tuo negozio eBay a Shopify, pronto a vendere." |
| Fatto | Branding iniziale | `BRAND.md`, ADR `docs/decisions/0002-branding.md` |
| Fatto | Tono UI e microcopy operativo | Prima versione in `BRAND.md`; da raffinare quando esiste la dashboard |
| Fatto | Logo e asset visuali base | PNG trasparenti/white, SVG wrapper raster, favicon/app icon e manifest in `brand/assets/` |
| Da fare | Screenshot prodotto | Screenshot dashboard/onboarding quando esiste la UI |
| Idea | Quality score import/listing | Da valutare solo se spiega rischi concreti senza metriche opache |

## 2. MVP prodotto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Connessione Shopify custom app | Dev store `syncbay-dev.myshopify.com` verificato via Shopify CLI preview, sessione persistita e audit installazione registrato |
| In corso | Connessione eBay.it OAuth | Flusso OAuth, state e cifratura token implementati; RuName production SyncBay predisposto senza OAuth sul keyset provvisorio FiscalBay; in attesa keyset dedicato per verifica end-to-end |
| In corso | Onboarding guidato | Readiness dashboard e wizard import preview iniziale predisposti; scelta location Shopify salvabile, preview mock fittizia e regole dry-run MVP codificate; restano lettura listing eBay e conferma import |
| Da fare | Import iniziale fino a 2.000 prodotti | Preview/dry-run, draft default, immagini copiate su Shopify; bloccato da OAuth eBay e lettura listing |
| Da fare | Sync catalogo entro 5 minuti | Real-time dove possibile e sostenibile; polling incrementale come fallback obbligatorio |
| Da fare | Consumer queue e schedule Supabase Cron | Da aggiungere quando esiste la logica import/sync; Vercel Cron resta fuori dal sync primario |
| Da fare | Protezione disponibilità | Ordine Shopify pagato -> aggiornamento disponibilità eBay prioritario |
| Da fare | Dashboard operativa | Stato sync, job, errori, conflitti, retry |
| Da fare | Regole prezzo Shopify-only | Sconto, markup, moltiplicatore, arrotondamento, prezzo minimo, margine minimo, compare-at |
| Da fare | Pulizia descrizioni eBay | HTML completo, testo pulito, template rimosso con anteprima |
| Da fare | Conflitti Shopify | Mantieni Shopify, riallinea da eBay, ignora campo |

## 3. Roadmap post-MVP

| Stato | Voce | Note |
| --- | --- | --- |
| Da fare | Matching prodotti esistenti | Wizard per collegare Shopify esistente a listing eBay |
| Da fare | Varianti migliorate | Varianti complesse, immagini variante, fallback guidati |
| Da fare | Multi-location avanzato | Oltre location predefinita MVP |
| Da fare | Growth tier | Fino a 10.000 prodotti, più resilienza e diagnostica |
| Da fare | Billing e app pubblica | Shopify App Store, privacy, self-service onboarding |
| Idea | Multi-marketplace | Solo dopo consolidamento eBay.it |

## 4. Sicurezza, dati e compliance

| Stato | Voce | Note |
| --- | --- | --- |
| Da fare | Cifratura token a riposo | Shopify/eBay refresh token |
| Da fare | Shopify GDPR webhook | Disinstallazione, cancellazione dati shop/customer dove richiesto |
| In corso | eBay marketplace account deletion | Challenge endpoint predisposto; notifiche POST disabilitate finché mancano verifica firma e cancellazione dati |
| Da fare | Audit log minimo | Connect, disconnect, refresh fallito, sync critici |
| Da fare | Rate limit e retry policy | Provider API e job queue |
| Da fare | Rollback import | Archiviare/ripristinare sessioni import |

## Prossime mosse suggerite

1. Attendere il keyset eBay dedicato SyncBay e sostituire i valori provvisori FiscalBay negli env.
2. Abilitare OAuth sul RuName del keyset dedicato, verificare OAuth eBay end-to-end e poi collegare il primo account venditore.
3. Preparare l'import Shopify draft controllato su dati mock/fixture, mantenendo `SYNCBAY_DRAFT_IMPORT_ENABLED=false` finché non viene scelta una verifica pilota.
4. Implementare lettura listing eBay per alimentare la preview import catalogo eBay -> Shopify senza sync automatico.
