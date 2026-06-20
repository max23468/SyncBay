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
- `0004-runtime-ci-release-future.md`: policy futura per runtime, CI e release dopo lo scaffold.
- `0005-runtime-infrastructure.md`: infrastruttura runtime MVP Vercel + Supabase.
- `0006-versioning-runtime-locale.md`: versioning SemVer locale in linea con Pratix.
- `0007-privacy-provvisoria-pilota.md`: privacy policy provvisoria per RuName eBay e pilota controllato.
- `0008-tag-e-github-release.md`: policy per tag `vX.Y.Z` e GitHub Release.
- `0009-shopify-token-offline-a-scadenza.md`: token offline Shopify a scadenza e refresh come requisito per i job automatici.
- `0010-ui-design-layer-e-marchi-terzi.md`: design layer UI minimo documentato e uso dei marchi eBay/Shopify.
- `0011-listing-inattivo-esaurito.md`: listing eBay inattivo mantenuto su Shopify come esaurito invece di archiviato, per preservare la SEO.
- `0012-impostazioni-avanzate-disconnessione-intervallo.md`: disconnessione eBay self-service reversibile e intervallo target sync configurabile (60-300 s).
- `0013-accento-ui-bay-blue-e-tema.md`: accento UI sul Bay Blue del logo con uso disciplinato e strategia tema chiaro theme-ready.
- `0015-mapping-categorie-ebay-shopify.md`: mapping categorie eBay -> Shopify per nuovi import e backfill controllato, senza tag categoria e senza apply massivo automatico.
- `0016-faccette-storefront-import.md`: import controllato di cinque faccette storefront da eBay verso metafield Shopify `syncbay_facets.*`.
- `0017-retention-dati-operativi.md`: retention tecnica per dati operativi del pilota.
- `0018-cleanup-retention-automatico.md`: cleanup retention automatico e idempotente nel tick cron, attivo per default.

## Convenzioni

- Numerazione progressiva `000N-titolo-breve.md`.
- Stato esplicito: Proposto, Accettato, Sostituito, Deprecato.
- Una decisione per file.
- Se una decisione cambia, non riscrivere la storia: crea un nuovo ADR o aggiorna lo stato con riferimento.
