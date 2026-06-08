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

## Uso

```bash
node scripts/preview-shot.mjs            # screenshot di tutte le pagine
node scripts/preview-shot.mjs panoramica # solo panoramica.html
```

I PNG finiscono in `preview/shots/` (desktop 1280 e stretto 390). In
alternativa apri direttamente i file `.html` in un browser.

## Fedeltà

- Reali: `app/styles/syncbay-embedded.css`, le classi `syncbay-*`, layout,
  spaziatura, responsive.
- Approssimati: tutto ciò che è `s-*` (bottoni, badge, sezioni, icone, testo) è
  uno stand-in CSS, non il componente Shopify.
- I dati sono fittizi e sintetici, mai dati reali di negozianti.

## Pagine

- `panoramica.html` — due scenari: "tutto sotto controllo" e "serve attenzione".

Le altre superfici si aggiungono qui man mano che il restyling procede.
