# ADR 0002 - Branding iniziale SyncBay

- **Stato**: Accettato
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay aveva già un perimetro prodotto chiaro: app Shopify eBay-first, con eBay.it come sorgente catalogo e Shopify come copia pulita e controllata. Mancava però una direzione brand stabile per tagline, tono, visual direction e messaggi da usare in documentazione, futura UI e materiali pubblici.

Il brand deve differenziarsi dalle app marketplace generaliste e non deve sembrare una copia o estensione ufficiale di eBay/Shopify. Il target iniziale è italiano, quindi il linguaggio deve essere immediato per negozianti italiani e ridurre inglesismi non necessari.

## Decisione

Adottare `BRAND.md` come fonte primaria del branding SyncBay.

Direzione proposta:

- nome prodotto: SyncBay;
- tagline principale: "Dal tuo negozio eBay a Shopify, pronto a vendere.";
- promessa: negozio eBay portato in un catalogo Shopify con schede ordinate, disponibilità sincronizzate e meno rischio di vendere prodotti non disponibili;
- tono: italiano, professionale, concreto, self-service, adatto a negozianti italiani;
- visual direction: SaaS operativo, pulito, sobrio, non marketplace urlato;
- logo definitivo: Catalog Bridge, con ponte blu, `Sync` verde, `Bay` blu e stanghette verdi/gialle/rosse;
- palette logo con richiamo cromatico controllato a eBay/Shopify, senza loghi ufficiali, forme proprietarie o claim di ufficialità;
- palette direzionale app distinta dal logo, da consolidare nel futuro design system.

## Conseguenze

- La UI futura deve restare italiana e operativa.
- La comunicazione deve evitare claim assoluti come "zero vendite oltre disponibilità" o "real-time garantito".
- La comunicazione deve evitare inglesismi non necessari: preferire "negoziante", "venditore", "disponibilità", "sincronizzazione", "anteprima" quando il contesto lo consente.
- Il brand deve enfatizzare anteprima, ripristino, conflitti chiari e diagnostica self-service.
- Gli asset approvati vivono in `brand/assets/` e vanno usati come fonte primaria per UI, documenti e materiali futuri.
- Il PNG approvato resta la source of truth visiva; gli SVG attuali sono wrapper raster fedeli e non ancora tracciati vettoriali puri.
- Gli export PNG trasparenti devono mantenere colori pieni e uniformi della palette approvata, senza ricavare trasparenze dai colori chiari.
- Prima di app pubblica, dominio o trademark, va fatta verifica legale/brand su nome e uso dei marchi eBay/Shopify.

## Alternative considerate

- **Brand marketplace generalista**: scartato per non competere frontalmente con suite multi-marketplace già mature.
- **Brand tecnico da motore di sincronizzazione**: scartato perché parlerebbe più agli sviluppatori che ai negozianti.
- **Brand vicino ai colori eBay/Shopify in modo letterale**: scartato per rischio confusione.
- **Richiamo cromatico controllato**: accettato per rendere immediato il ponte eBay -> Shopify senza sembrare un'app ufficiale.

## Riferimenti

- `BRAND.md`
- `docs/syncbay-product-technical-plan.md`
- `docs/market/shopify-ebay-app-benchmark.md`
