# Roadmap - SyncBay

Documento vivo. Ogni decisione di prodotto, tecnica o operativa che cambia perimetro, priorita o backlog deve confluire qui.

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
| Da fare | Prima issue/branch policy GitHub | Da definire quando il repo verra collegato a GitHub |

## 1. Identita prodotto

| Stato | Voce | Note |
| --- | --- | --- |
| Fatto | Nome prodotto: SyncBay | Shopify app eBay-first |
| Fatto | Posizionamento eBay.it-first | Catalogo eBay.it come sorgente, Shopify come copia pulita |
| Fatto | Formula prodotto | "SyncBay porta il tuo negozio eBay in un catalogo Shopify ordinato, con schede pronte a vendere, disponibilita sincronizzate e meno rischio di vendere prodotti non disponibili." |
| Fatto | Tagline principale | "Dal tuo negozio eBay a Shopify, pronto a vendere." |
| Fatto | Branding iniziale | `BRAND.md`, ADR `docs/decisions/0002-branding.md` |
| Fatto | Tono UI e microcopy operativo | Prima versione in `BRAND.md`; da raffinare quando esiste la dashboard |
| Fatto | Logo e asset visuali base | PNG trasparenti/white, SVG wrapper raster, favicon/app icon e manifest in `brand/assets/` |
| Da fare | Screenshot prodotto | Screenshot dashboard/onboarding quando esiste la UI |
| Idea | Quality score import/listing | Da valutare solo se spiega rischi concreti senza metriche opache |

## 2. MVP prodotto

| Stato | Voce | Note |
| --- | --- | --- |
| Da fare | Connessione Shopify custom app | Installazione, scope, token, webhook base |
| Da fare | Connessione eBay.it OAuth | Account venditore, token, refresh, marketplace `EBAY_IT` |
| Da fare | Onboarding guidato | Shopify, eBay, location, stato prodotti, immagini, descrizioni |
| Da fare | Import iniziale fino a 2.000 prodotti | Preview/dry-run, draft default, immagini copiate su Shopify |
| Da fare | Sync catalogo entro 5 minuti | Real-time dove possibile e sostenibile; polling incrementale come fallback obbligatorio |
| Da fare | Protezione disponibilita | Ordine Shopify pagato -> aggiornamento disponibilita eBay prioritario |
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
| Da fare | Growth tier | Fino a 10.000 prodotti, piu resilienza e diagnostica |
| Da fare | Billing e app pubblica | Shopify App Store, privacy, self-service onboarding |
| Idea | Multi-marketplace | Solo dopo consolidamento eBay.it |

## 4. Sicurezza, dati e compliance

| Stato | Voce | Note |
| --- | --- | --- |
| Da fare | Cifratura token a riposo | Shopify/eBay refresh token |
| Da fare | Shopify GDPR webhook | Disinstallazione, cancellazione dati shop/customer dove richiesto |
| Da fare | eBay marketplace account deletion | Subscription o opt-out corretto |
| Da fare | Audit log minimo | Connect, disconnect, refresh fallito, sync critici |
| Da fare | Rate limit e retry policy | Provider API e job queue |
| Da fare | Rollback import | Archiviare/ripristinare sessioni import |

## Prossime mosse suggerite

1. Preparare checklist account Shopify Partner/dev store ed eBay Developer.
2. Confermare prerequisiti e credenziali per Shopify/eBay.
3. Solo dopo conferma, passare allo scaffold applicativo.
