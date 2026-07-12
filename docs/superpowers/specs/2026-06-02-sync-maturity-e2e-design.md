# Test controllato maturità sync e stock

Data: 2026-06-02

## Obiettivo

Verificare con un test reale e reversibile che SyncBay gestisca i due flussi
critici del MVP:

- modifica eBay -> aggiornamento Shopify entro pochi minuti;
- ordine Shopify pagato -> aggiornamento disponibilità eBay entro pochi minuti.

Il test non deve lasciare modifiche permanenti sul listing eBay, sul prodotto
Shopify o sulla configurazione runtime. A fine verifica il sistema deve tornare
alla baseline precedente.

## Scope

Il test usa un solo listing eBay collegato a un solo prodotto/variante Shopify
tramite mapping SyncBay esistente.

Sono consentite solo modifiche temporanee e controllate a:

- prezzo del listing eBay;
- quantità del listing eBay;
- descrizione del listing eBay, solo con una modifica evidente e reversibile;
- disponibilità eBay ridotta da un ordine Shopify pagato di test;
- env runtime necessarie ad abilitare una scrittura reale eBay allowlistata.

Restano fuori scope:

- test su più listing;
- nuove integrazioni produttive;
- pubblicazione Shopify App Store;
- billing;
- cambio di provider, queue o runtime;
- refactor del motore sync non necessario al test.

## Baseline obbligatoria

Prima di ogni scrittura reale va salvata una baseline sanitizzata con:

- ItemID eBay;
- SKU eBay, se presente;
- Product GID e Variant GID Shopify;
- prezzo e valuta eBay;
- quantità eBay;
- titolo e descrizione eBay;
- stato prodotto Shopify;
- prezzo Shopify;
- quantità Shopify sulla location predefinita SyncBay;
- ultimo snapshot SyncBay collegato al mapping;
- stato job SyncBay pendenti o running per lo shop.

La baseline non deve contenere token, dati personali o segreti.

## Procedura raccomandata

1. Selezionare un mapping attivo e sicuro dallo store pilota Numisleo, preferendo un prodotto
   non critico e con valuta `EUR`.
2. Verificare che non ci siano job `UPDATE_EBAY_STOCK` o `SYNC_INCREMENTAL`
   attivi sullo stesso shop prima di iniziare.
3. Salvare la baseline eBay, Shopify e SyncBay.
4. Modificare temporaneamente su eBay prezzo, quantità o descrizione del
   listing selezionato.
5. Attendere o forzare il runner `/api/jobs/run-due` protetto da `CRON_SECRET`.
6. Verificare che Shopify rifletta la modifica entro il target di sync.
7. Lasciare `SYNCBAY_EBAY_STOCK_DRY_RUN=true` come default di sicurezza e
   abilitare scrittura reale solo per ItemID o variante test tramite
   `SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST`.
8. Creare o simulare un ordine Shopify pagato solo sul prodotto test.
9. Verificare che il job `UPDATE_EBAY_STOCK` riduca la disponibilità eBay o,
   se bloccato, registri un errore diagnostico corretto.
10. Ripristinare prezzo, quantità e descrizione eBay alla baseline.
11. Rimuovere o svuotare l'allowlist runtime usata per il test.
12. Eseguire un ultimo ciclo sync e verificare che Shopify torni allineato alla
    baseline.

## Criteri di successo

Il test è riuscito solo se:

- il job incrementale aggiorna Shopify da eBay entro pochi minuti;
- l'ordine Shopify crea un job prioritario `UPDATE_EBAY_STOCK`;
- il job stock applica la riduzione eBay reale solo al listing allowlistato;
- ogni job lascia risultato, warning o errore comprensibile;
- nessuna modifica reale resta dopo il rollback;
- la configurazione runtime ritorna allo stato precedente;
- i risultati sono documentati senza segreti.

## Criteri di stop

Interrompere il test e ripristinare subito la baseline se:

- viene selezionato un listing senza mapping affidabile;
- la valuta non è `EUR`;
- mancano snapshot SyncBay utili a calcolare la quantità precedente;
- ci sono job attivi che rendono ambigua la baseline;
- il provider restituisce errore non chiaro o rate limit critico;
- l'allowlist runtime risulta più ampia del singolo target di test.

## Verifiche locali prima del test

Prima del test provider, eseguire almeno:

- `git status --short`;
- `npm run test:stock-guard`;
- `npm run prisma:validate`;
- review dei job con `npm run jobs:status -- --shop numisleo.myshopify.com`.

Se cambiano codice o configurazione versionata, aggiungere anche `npm run
typecheck`, `npm run lint` e `npm run build` secondo rischio.

## Note sicurezza

Usare il keyset eBay dedicato SyncBay. Non stampare token, segreti, header di
autorizzazione, stringhe database o dati personali. Recuperare credenziali solo
da provider runtime o Portachiavi macOS quando serve.
