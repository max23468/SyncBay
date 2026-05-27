# Security Policy

SyncBay è in fase di pianificazione e fondazioni. Non esiste ancora runtime produttivo.

Questa policy fissa i principi minimi da rispettare già nella progettazione.

## Perimetro dati previsto

SyncBay potrà trattare:

- dati dello shop Shopify;
- token Shopify;
- dati account eBay;
- token eBay;
- listing, SKU, prezzi, quantità, immagini e descrizioni;
- dati minimi degli ordini Shopify necessari a proteggere la disponibilità;
- log tecnici, job, snapshot, conflitti e audit log.

## Segreti

Regole obbligatorie:

- non committare `.env` reali;
- non committare token, client secret, refresh token o chiavi di cifratura;
- non stampare segreti in log, errori o chat;
- verificare presenza dei segreti con controlli booleani, non con `echo`;
- cifrare token Shopify/eBay a riposo quando il runtime verrà implementato.

## Compliance minima prevista

Prima della beta reale servono:

- gestione disinstallazione Shopify;
- Shopify GDPR webhook dove richiesti;
- cancellazione o anonimizzazione dati shop su richiesta;
- gestione eBay marketplace account deletion notification o opt-out corretto;
- privacy policy;
- audit log minimo su connect, disconnect, revoca, refresh fallito e sync critici.

## Segnalazione problemi

Finché il progetto è privato e senza runtime pubblico, i problemi di sicurezza vanno segnalati direttamente al maintainer del repo.

Non aprire issue pubbliche con segreti, token, payload reali o dati del negoziante.

## Incident response minima

In caso di sospetto problema:

1. mettere in pausa sync o job coinvolti se esiste rischio di modifiche errate;
2. identificare provider coinvolto: Shopify, eBay, database, job queue o hosting;
3. sostituire credenziali se c'è rischio esposizione;
4. proteggere stock con modalità prudente se necessario;
5. usare snapshot/rollback dove possibile;
6. documentare incidente, impatto e correzione.
