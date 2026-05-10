# Guida onboarding e import

Questa guida definisce il flusso negoziante previsto per il MVP.

## Obiettivo

Il negoziante deve collegare Shopify ed eBay.it, vedere cosa verrà importato e avviare la creazione dei prodotti Shopify senza paura di sporcare il negozio.

## Flusso MVP

1. Installa SyncBay su Shopify.
2. Collega account eBay.it.
3. Sceglie location Shopify predefinita.
4. Sceglie stato iniziale prodotti: `draft` consigliato o pubblicato.
5. Sceglie import immagini: tutte per default.
6. Sceglie modalità descrizione:
   - HTML completo;
   - solo testo;
   - HTML pulito senza template.
7. Vede preview import:
   - prodotti importabili;
   - prodotti saltati;
   - errori;
   - esempi descrizione originale/pulita;
   - stima immagini;
   - regole prezzo applicate.
8. Conferma import.
9. Vede avanzamento job e risultati.

## Stato preparatorio implementato

La dashboard embedded mostra già una readiness operativa per:

- connessione Shopify, scope e webhook pilota;
- runtime Vercel/Supabase;
- eBay OAuth predisposto ma bloccato fino al keyset dedicato;
- endpoint account deletion predisposto ma notifiche reali non abilitate;
- default import e blocker della preview.

La preview import resta bloccata finché non sono disponibili:

- account eBay collegato via OAuth;
- location Shopify predefinita;
- logica di lettura listing eBay.

## Default consigliati

- Prodotti iniziali in `draft`.
- Tutte le immagini copiate su Shopify.
- Una sola location Shopify predefinita.
- Nessun matching automatico aggressivo con prodotti Shopify esistenti.
- Nessun publish massivo senza conferma.

## Errori da mostrare chiaramente

- account eBay non collegato;
- token scaduto;
- listing non leggibile;
- SKU mancante;
- variante troppo complessa;
- immagine non scaricabile;
- rate limit;
- errore Shopify media/prodotto.

Ogni errore deve avere impatto e prossima azione consigliata.
