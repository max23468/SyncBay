# Backlog - SyncBay

Questo documento raccoglie idee, debiti e attività non ancora promosse nella roadmap operativa. Una voce nel backlog non è scope approvato. La direzione e le prossime mosse stanno in `docs/ROADMAP.md`.

## Regole

- Non usare il backlog come autorizzazione a implementare.
- Promuovi una voce in `docs/ROADMAP.md` solo quando diventa prioritaria o decisa.
- Le decisioni aperte restano in `docs/DECISIONS_PENDING.md` finché non diventano ADR o vengono scartate.
- Non allargare SyncBay a marketplace generico bidirezionale senza decisione esplicita.

## Idee prodotto non ancora scelte

| Voce | Stato | Nota |
| --- | --- | --- |
| Quality score import/listing | Idea | Da valutare solo se spiega rischi concreti al negoziante senza introdurre metriche opache. |
| Multi-marketplace | Idea | Fuori scope finché eBay.it-first non è consolidato. |
| Support policy pubblica | Da definire | Serve prima dell'app pubblica Shopify App Store; default attuale: self-service first. |
| Billing | Da definire | Fuori dalla custom app pilota; necessario prima di una distribuzione pubblica. |

## Debiti tecnici e operativi

| Voce | Stato | Nota |
| --- | --- | --- |
| Rimozione override `ajv` | Aperta | Issue GitHub #12: rimuovere l'override quando `@vercel/static-config` o `@vercel/react-router` useranno a monte una versione patchata. |
| CI runtime completa | Aperta | ADR `docs/decisions/0004-runtime-ci-release-future.md`; non aggiungere workflow generici senza gate reali. |
| Policy production e App Store | Aperta | Esiste un deployment Vercel production per il pilota, ma mancano ancora criteri stabili per app pubblica, promozione production e Shopify App Store. |
| Verifica smoke post-deploy | Aperta | Da rendere gate stabile solo quando criteri production, ambienti e app pubblica saranno decisi. |
| Logo eBay consent page | Aperta | Riprovare upload logo su eBay Developer: il portale rifiuta PNG e JPG SyncBay con errore generico, mentre About URL e branding testuale sono configurabili. |

## Decisioni collegate

- Decisioni aperte: `docs/DECISIONS_PENDING.md`
- Policy Git/pubblicazione: `docs/guides/git-e-pubblicazione.md`
- Versioning e release: `docs/guides/versioning-e-release.md`
- Runtime e CI futuri: `docs/decisions/0004-runtime-ci-release-future.md`
