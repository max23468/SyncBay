# Preview UI locale

Ambiente di test **visivo** locale per il design layer SyncBay, da usare quando
non è possibile aprire l'app embedded dentro Shopify Admin.

## Perché esiste

I Polaris Web Components (`s-page`, `s-section`, `s-stack`, `s-icon`, …) sono
registrati **solo** dal runtime App Bridge dentro Shopify Admin embedded. Fuori
da quel contesto non esistono come elementi definiti (verificato: App Bridge non
li espone standalone) e non c'è un pacchetto runtime pubblico. Quindi una resa
_pixel-true_ in locale non è possibile senza una sessione Admin autenticata.

Questo harness aggira il limite con **stand-in neutri** dei componenti `s-*`
(`polaris-preview.css`) e renderizza il **design layer SyncBay reale**
(`app/styles/syncbay-embedded.css` e i suoi wrapper). Serve a giudicare:

- gerarchia e densità;
- ritmo di spaziatura;
- comportamento responsivo (collasso multi-colonna);
- tinte, icone e accenti del design layer.

Non valida la resa esatta dei componenti Shopify: per quella restano il pilota
Vercel e Shopify Admin.

## Tre modalità

### 1. Smoke veloce con fixture sintetica (default design)

Per iterare su layout e regressioni evidenti non serve avviare Supabase o
aprire Shopify Admin. Il comando renderizza il **componente di route reale**
con dati sintetici/sanitizzati in memoria e salva HTML + screenshot in
`preview/shots/`:

```bash
npm run ui:preview
npm run ui:preview:attivita
npm run ui:preview:catalogo
npm run ui:preview:conflitti
npm run ui:preview:impostazioni
npm run ui:preview:importazione
npm run ui:preview:panoramica
```

È il percorso da usare per QA rapido di densità, colonne, responsive, gerarchia,
testi principali e assenza di rendering rotto.

### 2. Render con DATI REALI

`scripts/syncbay-ui-render.mjs` esegue il **componente di route reale** via Vite
SSR, alimentato dai **loader veri** letti dalla sessione offline nel database
locale (Supabase). Nessun browser autenticato, nessun Safari, nessun Shopify
Admin: senza `--fixture` i dati sono quelli dello shop collegato in locale;
con `--fixture` sono esclusivamente sintetici.

```bash
npm run ui:render panoramica   # render dati reali + screenshot desktop/narrow
npm run ui:render catalogo      # render Catalogo con dati reali locali
```

Prerequisiti: Supabase locale attivo (`npx supabase start`, richiede Docker) e
un `.env` con `DATABASE_URL` locale e una sessione installata nel database.
Output: `preview/shots/<pagina>-live.html` + PNG.

#### Stato "collegato" in locale

Un'installazione locale fresca mostra lo stato vuoto (eBay non collegato, 0
prodotti). Per vedere la preview nello stato collegato come in produzione:

```bash
npm run ui:seed-local   # eBay CONNECTED, 992 prodotti, 115 conflitti aperti
```

`scripts/syncbay-seed-local-preview.sql` riproduce i **conteggi e lo stato reali
di produzione** (numeri aggregati e date), **senza dati personali del
negoziante**: nessun token reale, ebayUserId e gid sintetici. È idempotente e
opera solo su righe `seed-%`. Serve per QA visivo locale, non per test
funzionali del sync.

Solo la chrome dei componenti `s-*` resta simulata. Tutto il resto — dati,
componente di route, design layer, gerarchia — è reale.

### 3. Screenshot live dentro Shopify Admin

Quando serve verificare la resa embedded reale, usa Playwright con profilo
persistente dedicato. Al primo avvio si apre Chromium per il login Shopify; le
esecuzioni successive riusano `.shopify-pw-profile/`, che è gitignorato.

```bash
npm run ui:shot-live                  # Panoramica
npm run ui:shot-live -- Catalogo      # voce nav Catalogo
HEADLESS=1 npm run ui:shot-live -- Conflitti conflitti
```

Output: `preview/shots/<nome>-real.png` e, quando disponibile, anche lo
screenshot del frame embedded. Questo percorso valida l'integrazione Admin; per
QA rapido e ripetibile resta preferibile `npm run ui:preview`.

## Fedeltà

- Reali: `app/styles/syncbay-embedded.css`, le classi `syncbay-*`, layout,
  spaziatura, responsive.
- Approssimati: tutto ciò che è `s-*` (bottoni, badge, sezioni, icone, testo) è
  uno stand-in CSS, non il componente Shopify.
- I dati fixture sono sintetici; il render live locale usa solo dati reali o
  aggregati già presenti nel database locale, senza token o dati personali in
  output.

## Pagine coperte

Il renderer fixture usa i componenti di route reali per le sei superfici
ridisegnate e ricontrollate nel ciclo corrente:

- `panoramica` — centro operativo e stato collegamenti;
- `catalogo` — tabella prodotti, thumbnail e stato unico;
- `conflitti` — KPI di sicurezza operativa e decision card;
- `importazione` — step progressivi, location e preview paginata;
- `attivita` — coda operativa, timeline e diagnostica progressiva;
- `impostazioni` — schede operative per sync, import, canali e avanzate.
