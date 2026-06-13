# ADR 0010 - Design layer UI e uso marchi eBay/Shopify

- **Stato**: Accettato
- **Data**: 2026-06-08
- **Decisori**: maintainer, Claude

## Contesto

La UI embedded di SyncBay è stata ridisegnata (vedi
`docs/guides/ui-concepts-handoff.md`) su Polaris Web Components con la regola
"75% Shopify-native, 25% identità SyncBay" e CSS custom limitato a identità
minima e disclosure tecnici.

In revisione il maintainer ha valutato la resa attuale ancora piatta rispetto ai
sei concept di riferimento: gerarchia debole, sezioni tutte dello stesso peso,
vocabolario nativo sotto-utilizzato (per esempio `s-icon` non era usato da
nessuna parte). Migliorare gerarchia, densità e coerenza richiede un margine
visivo leggermente superiore a quello già documentato, e i concept prevedono
indicatori di collegamento eBay/Shopify.

Questo tocca due regole stabili: il confine del CSS custom e l'uso di marchi di
terze parti. Entrambe vanno fissate prima di propagare il restyling alle pagine.

## Decisione

### Design layer documentato

Resta la direzione "Shopify-native prima". Si autorizza un **design layer
minimo e a lista chiusa** sopra i componenti nativi. Le uniche deroghe CSS
ammesse oltre allo styling dei disclosure `details/summary` sono:

1. **Tile metrica** con `s-icon` e sfondo a tinta tenue derivata dalla palette
   semantica SyncBay.
2. **Pannello connessioni** che mostra i collegamenti eBay/Shopify con i
   rispettivi marchi come indicatori di sorgente/destinazione.
3. **Hero di stato** (pannello prossima-azione/stato) con icona di stato e
   accento tonale per dominare la gerarchia di pagina.
4. **Decision card conflitto**: scheda per singolo conflitto con accento tonale
   a sinistra keyato sulla gravità della scelta (batch sicuro / da rivedere /
   manuale), stessa logica visiva dell'hero.
5. **Pannello sorgente** del confronto eBay/Shopify dentro la decision card:
   marchio del provider + valore, con il lato eBay evidenziato come sorgente di
   verità (ADR 0011).
6. **Tappa stepper** (Importazione): nodo numerato o spuntato con connettore
   verticale, per dare il senso di avanzamento del flusso di import; lo stato di
   ogni tappa (completata / da fare ora / in attesa) deriva dai dati reali del
   wizard.
7. **Evento timeline** (Attività): nodo con icona colorata per esito e
   connettore verticale, per leggere la cronologia operativa come timeline
   invece che come pila di box uguali.
8. **Scheda impostazione** (Impostazioni): box verticale con intestazione icona
   + titolo + badge di stato corrente a colpo d'occhio, poi i controlli; tiene
   le regole essenziali leggibili senza aprire ogni sezione.

Estensione 2026-06-14 (Panoramica), stessa logica di wrapper in light DOM
attorno a componenti nativi:

9. **Battito del sync** (Panoramica): flusso eBay -> SyncBay -> Shopify con nodi
   icona, connettori etichettati dai conteggi reali e stato animato quando un
   job è attivo (pallini in viaggio, hub che ruota), statico a riposo. Con
   `prefers-reduced-motion` resta statico, i numeri restano. È l'elemento-firma
   della pagina e rende esplicito il modello sorgente -> destinazione (ADR 0011).
10. **Lente rischio disponibilità** (Panoramica): la card più pesante della
    pagina, in tono di attenzione, per i prodotti che rischiano di essere
    venduti senza scorta; a zero diventa rassicurazione verde. Mette in primo
    piano il valore #1 del prodotto (protezione disponibilità, ADR 0011).
11. **Sparkline affidabilità** (Panoramica): mini-andamento delle
    sincronizzazioni degli ultimi 7 giorni in accento, da aggregazione dello
    storico job; serie vuota o piatta resa come baseline, mai dati sintetici.

Il first-run della Panoramica riusa la **tappa stepper** (punto 6) per
l'onboarding guidato Collega -> Importa -> Attiva. L'accento di questi elementi
è il Bay Blue del logo con uso disciplinato (ADR 0013), non più il solo
`Harbor` teal.

Tutto ciò che non è in questa lista resta nativo puro. La griglia condivisa è
**multi-regione responsiva**: hero a tutta larghezza, poi fasce a due colonne
che collassano a una su viewport stretto. Restano vietati: viola, gradienti
dominanti, orb/decorazioni astratte, hero marketing, shell custom o
colorazione sistematica dei componenti Shopify.

Espandere questa lista richiede aggiornare questa ADR.

### Marchi eBay e Shopify

Si autorizza l'uso dei **marchi ufficiali eBay e Shopify** come piccoli
indicatori sobri di collegamento, sorgente o destinazione, mai come
co-branding dominante o claim di ufficialità. Prima dell'uso vanno verificate
le brand guideline ufficiali dei due provider; se l'uso previsto non è
conforme, si ricade su indicatori neutri (nome testuale + icona generica). Gli
asset vivono in `brand/assets/` con provenienza dichiarata.

## Alternative considerate

- **Restare alla regola attuale senza deroghe**: scartato perché chiude la via
  alla gerarchia/densità richiesta entro il nativo puro.
- **Avvicinare i concept con CSS custom ampio** (tile piene, aside permanenti,
  shell): scartato perché romperebbe il vincolo native e reintrodurrebbe
  elementi già scartati nell'handoff.
- **Indicatori neutri al posto dei marchi reali**: scartato come default, ma
  resta il fallback obbligato se le guideline lo impongono.

## Conseguenze

- L'handoff `docs/guides/ui-concepts-handoff.md` è aggiornato con il nuovo
  confine e la lista chiusa del design layer.
- Il restyling procede a sistema condiviso + Panoramica come pagina-prova, poi
  propagazione alle altre cinque superfici.
- Il lavoro può toccare presentazione, riordino, microcopy e, se necessario,
  loader/selector; quando un loader cambia, la verifica sale a corsia completa.
- Resta valida la regola di non introdurre Polaris React legacy.

## Riferimenti

- `docs/guides/ui-concepts-handoff.md`
- `docs/decisions/0002-branding.md`
- `BRAND.md`
- `app/styles/syncbay-embedded.css`
