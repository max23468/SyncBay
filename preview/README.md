# Preview UI locale

Ambiente di test **visivo** locale per il design layer SyncBay, da usare quando
non è possibile aprire l'app embedded dentro Shopify Admin.

## Perché esiste

I Polaris Web Components (`s-page`, `s-section`, `s-stack`, `s-icon`, …) sono
registrati **solo** dal runtime App Bridge dentro Shopify Admin embedded. Fuori
da quel contesto non esistono come elementi definiti (verificato: App Bridge non
li espone standalone) e non c'è un pacchetto runtime pubblico. Quindi una resa
*pixel-true* in locale non è possibile senza una sessione Admin autenticata.

Questo harness aggira il limite con **stand-in neutri** dei componenti `s-*`
(`polaris-preview.css`) e renderizza il **design layer SyncBay reale**
(`app/styles/syncbay-embedded.css` e i suoi wrapper). Serve a giudicare:

- gerarchia e densità;
- ritmo di spaziatura;
- comportamento responsivo (collasso multi-colonna);
- tinte, icone e accenti del design layer.

Non valida la resa esatta dei componenti Shopify: per quella restano il pilota
Vercel e Shopify Admin.

## Due modalità

### 1. Render con DATI REALI (consigliato)

`scripts/syncbay-ui-render.mjs` esegue il **componente di route reale** via Vite
SSR, alimentato dai **loader veri** letti dalla sessione offline nel database
locale (Supabase). Nessun browser autenticato, nessun Safari, nessun Shopify
Admin: i dati sono quelli reali dello shop collegato in locale (dev store).

```bash
npm run ui:render panoramica   # render dati reali + screenshot desktop/narrow
```

Prerequisiti: Supabase locale attivo (`npx supabase start`, richiede Docker) e
un `.env` con `DATABASE_URL` locale e una sessione installata nel database.
Output: `preview/shots/<pagina>-live.html` + PNG.

Solo la chrome dei componenti `s-*` resta simulata. Tutto il resto — dati,
componente di route, design layer, gerarchia — è reale. Le pagine vanno cablate
in `PAGES` man mano che vengono ridisegnate (per ora: `panoramica`).

### 2. Harness con dati finti

`scripts/preview-shot.mjs` screenshotta gli HTML statici in `preview/` con dati
sintetici. Utile quando il database locale non è disponibile.

```bash
npm run ui:preview-shot            # tutte le pagine statiche
node scripts/preview-shot.mjs panoramica
```

I PNG finiscono in `preview/shots/` (desktop e stretto). In alternativa apri
direttamente i file `.html` in un browser.

## Fedeltà

- Reali: `app/styles/syncbay-embedded.css`, le classi `syncbay-*`, layout,
  spaziatura, responsive.
- Approssimati: tutto ciò che è `s-*` (bottoni, badge, sezioni, icone, testo) è
  uno stand-in CSS, non il componente Shopify.
- I dati sono fittizi e sintetici, mai dati reali di negozianti.

## Pagine

- `panoramica.html` — due scenari: "tutto sotto controllo" e "serve attenzione".

Le altre superfici si aggiungono qui man mano che il restyling procede.
