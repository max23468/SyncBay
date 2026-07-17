# ADR 0013 - Accento UI Bay Blue e strategia tema light theme-ready

- **Stato**: Accettato
- **Data**: 2026-06-14
- **Decisori**: maintainer, Claude

## Contesto

Il redesign della Panoramica (ADR 0010, estensione 2026-06-14) ha richiesto di
fissare due punti lasciati aperti dalla palette direzionale di `BRAND.md`:

1. **Accento UI.** La palette direzionale dell'app indicava `Harbor` `#0F5E6E`
   (teal) come brand primario e `Current` `#1A8F7A` come azione, mentre il logo
   definitivo (ADR 0002) usa Bay Blue `#0064D2`. Le due palette non si
   parlavano: l'app non riprendeva il colore del proprio logo. Il maintainer ha
   scelto di unificare l'identità sul Bay Blue del logo.

2. **Tema chiaro/scuro.** L'admin Shopify è di fatto light-only e non espone un
   dark mode al negoziante; un'app embedded scura dentro un admin chiaro
   sembrerebbe rotta, non premium. Allo stesso tempo i colori non vanno
   inchiodati a hex fissi, per non dover riscrivere tutto se un dark mode
   diventasse rilevante (admin o App Store pubblica).

I colori eBay/Shopify sono vicini ai marchi dei due provider, e AGENTS vietava
colori che facessero sembrare SyncBay un'app ufficiale eBay/Shopify. Quel
vincolo era motivato dalla review dell'App Store pubblico. Il maintainer ha
confermato che **l'app sarà distribuita in privato** (non pubblicata sullo
Store, almeno per ora): quindi il rischio "sembra ufficiale" non è più un
blocco, ed è una **scelta di design deliberata** del maintainer usare i colori
eBay/Shopify come sistema semantico. AGENTS va aggiornato di conseguenza.

## Decisione

- **Palette semantica = colori del logo eBay/Shopify** (decisione maintainer,
  aggiornamento 2026-06-14): il verde di Shopify sostituisce il verde di eBay,
  e i quattro colori diventano i ruoli di stato dell'app:
  - **success = verde Shopify `#95BF47`**;
  - **info = blu eBay `#0064D2`**;
  - **warning = giallo eBay `#F5AF02`**;
  - **error = rosso eBay `#E53238`**.
    Ogni ruolo ha tre forme: hue di marca (bordi/icone/accenti), **tinta tenue**
    per gli sfondi e una **versione scura per il testo** (`-text`), perché gli hue
    di marca da soli non hanno contrasto sufficiente come testo su bianco.
- **Brand primario = blu eBay `#0064D2`**, **secondario = verde Shopify
  `#95BF47`**.
- **Accento UI = Bay Blue `#0064D2`** (con `#0a4a94` per gli stati forti): link,
  stati attivi, nodo/hub del battito, sparkline, focus e bottoni primari del
  design layer. **Blu = info E blu = primario coincidono** per scelta: si
  distinguono per _trattamento_, non per tinta — il primario/azione usa il blu
  **pieno**, l'informativo usa la **tinta tenue** + testo blu scuro. Le
  superfici restano neutre; i colori di marca vivono su accenti, icone, badge e
  bordi, non come campiture diffuse o banner che ricreino il logo eBay.
- **Tema: solo chiaro, ma theme-ready.** Niente dark mode spedito, niente
  interruttore: SyncBay segue l'admin (chiaro). I colori del design layer sono
  espressi come **variabili semantiche** (`--syncbay-success/-warning/-critical/
-info` con `-text`/`-tint`, `--syncbay-accent` ecc.) così un eventuale dark
  mode futuro è un cambio di un blocco di variabili, non una riscrittura.

Questa decisione **sostituisce** la palette direzionale semantica di `BRAND.md`
e ADR 0002 (i toni muti `Harbor`/`Current`/`Moss`/`Amber`/`Coral`/`Steel` come
ruoli di stato e accento). Restano validi superfici, testi e bordi neutri
(Cloud/Paper/Ink/Slate/Mist). `Harbor`/`Current` sopravvivono come colori di
palette legacy, senza ruolo semantico.

## Conseguenze

- L'app riprende i colori del proprio logo e dei due provider: identità coesa e
  modello eBay→Shopify leggibile a colpo d'occhio.
- Resta una percezione "vicina a eBay/Shopify": accettata, perché la
  distribuzione è privata. Da **rivalutare solo se** si deciderà la
  pubblicazione sull'App Store pubblico (verifica brand/legale già prevista da
  ADR 0002).
- Lettura/contrasto: gli hue di marca sono saturi e poco contrastati come testo;
  per questo ogni ruolo ha la variante `-text` scura e si tengono le superfici
  neutre, per non diventare "urlati" su una dashboard densa.
- I nuovi componenti del design layer e le superfici future devono usare le
  variabili semantiche (`-text`/`-tint` incluse), non hex fissi.
- La propagazione alle altre cinque superfici dovrà riconciliare i riferimenti
  residui a `Harbor`/`Current` e ai vecchi toni muti verso le variabili
  semantiche brandizzate.
- `Harbor`/`Current` restano colori di palette legacy, senza ruolo semantico.

## Alternative considerate

- **Ereditare i token dell'admin + costruire un dark mode**: scartato perché
  l'admin è light-only e un riquadro scuro sembrerebbe rotto; nessun tema scuro
  da seguire oggi.
- **Tenere `Harbor` teal come accento** (più distante dai marchi, più sicuro in
  review): proposto come raccomandazione, ma il maintainer ha preferito l'unità
  col logo accettando il rischio, da documentare e rivalutare.
- **Palette nuova autonoma solo-chiaro senza astrazione**: scartata perché
  costringerebbe a riscrivere i colori se servisse il dark mode.

## Riferimenti

- `docs/decisions/0002-branding.md`
- `docs/decisions/0010-ui-design-layer-e-marchi-terzi.md`
- `docs/decisions/0011-listing-inattivo-esaurito.md`
- `BRAND.md`
- `app/styles/syncbay-embedded.css`
- `AGENTS.md` (divieto colori che simulano app ufficiali eBay/Shopify)
