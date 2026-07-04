# Architecture Decision Records

Questo registro contiene le decisioni stabili del progetto. Le ADR puntuali
vivono in `docs/decisions/`.

Usa un ADR quando una scelta:

- cambia architettura o stack;
- fissa una policy operativa;
- introduce vincoli di sicurezza, deploy, dati o release;
- chiude un tradeoff importante;
- deve restare comprensibile anche fra mesi.

## Indice

- `0001-stack.md`: stack iniziale SyncBay.
- `0002-branding.md`: branding iniziale SyncBay.
- `0003-git-pubblicazione-versioning.md`: policy GitHub, pubblicazione e versioning.
- `0004-runtime-ci-release-future.md`: runtime, CI e release dopo lo scaffold; CI runtime completa (`ci.yml`) attivata il 2026-06-27, deploy/release remoti ancora prudenti.
- `0005-runtime-infrastructure.md`: infrastruttura runtime Vercel + Supabase.
- `0006-versioning-runtime-locale.md`: versioning SemVer locale in linea con Pratix.
- `0007-privacy-provvisoria-pilota.md`: privacy policy provvisoria storica per RuName eBay.
- `0008-tag-e-github-release.md`: policy per tag `vX.Y.Z` e GitHub Release.
- `0009-shopify-token-offline-a-scadenza.md`: token offline Shopify a scadenza e refresh come requisito per i job automatici.
- `0010-ui-design-layer-e-marchi-terzi.md`: design layer UI minimo documentato e uso dei marchi eBay/Shopify.
- `0011-listing-inattivo-esaurito.md`: listing eBay inattivo mantenuto su Shopify come esaurito invece di archiviato, per preservare la SEO.
- `0012-impostazioni-avanzate-disconnessione-intervallo.md`: disconnessione eBay self-service reversibile e intervallo target sync configurabile storico (120-300 s), aggiornato da ADR 0021.
- `0013-accento-ui-bay-blue-e-tema.md`: accento UI sul Bay Blue del logo con uso disciplinato e strategia tema chiaro theme-ready.
- `0015-mapping-categorie-ebay-shopify.md`: mapping categorie eBay -> Shopify per nuovi import e backfill controllato, senza tag categoria e senza apply massivo automatico.
- `0016-faccette-storefront-import.md`: import controllato di cinque faccette storefront da eBay verso metafield Shopify `syncbay_facets.*`.
- `0017-retention-dati-operativi.md`: retention tecnica per dati operativi.
- `0018-cleanup-retention-automatico.md`: cleanup retention automatico e idempotente nel tick cron, attivo per default.
- `0019-cadenza-cron-runner.md`: cadenza Supabase Cron del runner ogni 2 minuti con target sync minimo a 120 s, sostituita da ADR 0021.
- `0020-1-0-custom-privata-catalogo-esistente.md`: perimetro 1.0 custom privata e collegamento di cataloghi Shopify esistenti senza funzioni Numisleo-specifiche.
- `0021-cadenza-cron-e-target-risparmio-egress.md`: cadenza Supabase Cron ogni 5 minuti e target sync configurabile 5-30 minuti in modalità risparmio egress.

## Convenzioni

- Numerazione progressiva `000N-titolo-breve.md`.
- Stato esplicito: Proposto, Accettato, Sostituito, Deprecato.
- Una decisione per file.
- Se una decisione cambia, non riscrivere la storia: crea un nuovo ADR o aggiorna lo stato con riferimento.
