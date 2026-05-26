# Roadmap - SyncBay

Documento vivo. Ogni decisione di prodotto, tecnica o operativa che cambia perimetro, priorità o backlog deve confluire qui.

Riferimenti: `../AGENTS.md`, `../README.md`, `syncbay-product-technical-plan.md`.

Legenda stato: Fatto | In corso | Da fare

Le idee e i debiti non ancora promossi stanno in `BACKLOG.md`.

---

## 0. Fondazioni progetto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Piano prodotto e tecnico | `docs/syncbay-product-technical-plan.md` |
| Fatto | Benchmark Shopify App Store | `docs/market/shopify-ebay-app-benchmark.md` |
| Fatto | Stack iniziale documentato | ADR `docs/decisions/0001-stack.md` |
| Fatto | Regole operative agenti | `AGENTS.md` |
| Fatto | Sistema documentale base | `docs/INDEX.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/CONTEXT.md`, `docs/TOOLCHAIN.md`, changelog, glossario, guide e data model concettuale |
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
| Fatto | Modello mapping/snapshot/conflitti | Schema Prisma e migration applicati su Supabase; l'import draft pilota registra mapping, snapshot, job e audit per bozze create o riusate |

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

## 2. MVP prodotto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Connessione Shopify custom app | Dev store `syncbay-dev.myshopify.com` verificato via Shopify CLI preview, sessione persistita e audit installazione registrato |
| Fatto | Connessione eBay.it OAuth | Flusso OAuth, state, cifratura token e recupero `userId` via Identity API verificati end-to-end sul keyset dedicato SyncBay |
| Fatto | Onboarding guidato | Readiness dashboard e wizard import preview predisposti; scelta location Shopify salvabile, preview live Inventory API con fallback Trading API/GetItem sui primi 10 listing del batch preview, SKU fallback, regole dry-run MVP codificate e import draft pilota confermato sul dev store |
| In corso | Import iniziale fino a 2.000 prodotti | Batch 25 verificato con bozze Shopify idempotenti; ora l'import controllato registra mapping, snapshot, job e audit ed espone lo storico in dashboard. Resta espandere copertura fino al limite MVP |
| Da fare | Sync catalogo entro 5 minuti | Real-time dove possibile e sostenibile; polling incrementale come fallback obbligatorio |
| In corso | Job import e retry | Import draft tracciato con `SyncJob` idempotente, tentativi, risultato, audit e retry pianificato con backoff; runner HTTP protetto collegato a Supabase Cron ogni minuto per job `IMPORT_CATALOG` dovuti. Restano job sync/stock futuri |
| Da fare | Protezione disponibilità | Ordine Shopify pagato -> aggiornamento disponibilità eBay prioritario |
| In corso | Dashboard operativa | Stato connessioni, job recenti, storico import, conteggi mapping/snapshot e rimessa in coda manuale; restano conflitti e azioni sync complete |
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

## 4. Sicurezza, dati e compliance

| Stato | Voce | Note |
| --- | --- | --- |
| Da fare | Cifratura token a riposo | Shopify/eBay refresh token |
| Da fare | Shopify GDPR webhook | Disinstallazione, cancellazione dati shop/customer dove richiesto |
| Fatto | eBay marketplace account deletion | Challenge GET e POST con verifica firma e cleanup dati eBay implementati, migration/deploy runtime applicati e test notification eBay superata |
| Da fare | Audit log minimo | Connect, disconnect, refresh fallito, sync critici |
| In corso | Rate limit e retry policy | Backoff import draft e runner Cron per job dovuti predisposti; restano policy provider API complete per sync incrementale e stock |
| Da fare | Rollback import | Archiviare/ripristinare sessioni import |

## Prossime mosse suggerite

1. Osservare i primi run Supabase Cron del runner `/api/jobs/run-due` e verificare retry reali quando compaiono job `RETRYING`.
2. Dopo batch 25 stabile, valutare il passaggio a 50 prodotti.
3. Iniziare il sync incrementale eBay -> Shopify.
4. Implementare la protezione disponibilità Shopify -> eBay per ordini pagati.
