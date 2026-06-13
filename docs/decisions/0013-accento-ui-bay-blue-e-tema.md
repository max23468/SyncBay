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

Bay Blue è vicino al blu associato a eBay. AGENTS vieta colori che facciano
sembrare SyncBay un'app ufficiale eBay/Shopify. La scelta è quindi una **deroga
consapevole**, approvata dal maintainer, da vincolare a un uso disciplinato.

## Decisione

- **Accento UI = Bay Blue `#0064D2`** (con `#0a4a94` per gli stati forti), usato
  **con disciplina**: link, stati attivi, nodo/hub del battito, sparkline,
  bordi di focus e bottoni primari del design layer. **Vietato** come campitura
  diffusa, header pieni, barre o accostamenti blu+giallo+rosso che ricreino la
  chrome di eBay. Le superfici restano neutre allineate all'admin; l'identità
  vive nell'accento e negli asset di brand, non nella colorazione delle
  superfici.
- **Tema: solo chiaro, ma theme-ready.** Niente dark mode spedito, niente
  interruttore: SyncBay segue l'admin (chiaro). I colori del design layer sono
  espressi come **variabili semantiche** (`--syncbay-accent`,
  `--syncbay-accent-strong`, `--syncbay-accent-tint`, oltre alle superfici/testi
  esistenti) così un eventuale dark mode futuro è un cambio di un blocco di
  variabili, non una riscrittura.

Questa decisione **sostituisce** la parte "brand primario `Harbor` / azione
`Current`" della palette direzionale app di `BRAND.md` e ADR 0002, limitatamente
all'accento UI. Il resto della palette direzionale (superfici, testi, semantici
successo/warning/critico) resta valido.

## Conseguenze

- L'app riprende il colore del proprio logo: identità più coesa.
- Aumenta il rischio di percezione "app eBay ufficiale": mitigato dall'uso
  disciplinato e dalla chrome neutra. Da rivalutare prima dell'invio all'App
  Store pubblica (verifica brand/legale già prevista da ADR 0002).
- I nuovi componenti del design layer e le superfici future devono usare le
  variabili semantiche, non hex fissi.
- La propagazione alle altre cinque superfici dovrà riconciliare i riferimenti
  residui a `Harbor`/`Current` verso l'accento e le variabili semantiche.
- `Harbor` teal resta disponibile come colore di palette, ma non è più
  l'accento UI primario.

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
