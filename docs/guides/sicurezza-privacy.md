# Guida sicurezza e privacy

Questa guida fissa i requisiti minimi di sicurezza e privacy per SyncBay.

## Dati trattati

SyncBay potrà trattare:

- dati shop Shopify;
- token Shopify;
- dati account eBay;
- token eBay;
- listing, immagini, SKU, prezzi e quantità;
- ordini Shopify minimi necessari a proteggere la disponibilità;
- log tecnici e audit.

## Regole segreti

- Non committare segreti o `.env` reali.
- Non loggare token o payload sensibili.
- Token eBay persistiti da SyncBay cifrati a riposo.
- Token Shopify ancora gestiti dallo storage sessioni del template Shopify; prima della beta reale va deciso se sostituire o cifrare quello storage.
- Chiavi di cifratura fuori repo.
- Rotazione token da documentare prima della beta reale.

Runtime deciso:

- Vercel env secrets per app e backend HTTP.
- Supabase project secrets solo per funzioni/servizi Supabase che ne avranno bisogno.
- Supabase Postgres come database, ma la cifratura at-rest del provider non sostituisce la cifratura applicativa dei token OAuth.
- `TOKEN_ENCRYPTION_KEY` custodita nei provider runtime, mai nel repository.

Per Supabase, non esporre tabelle operative a client pubblici senza RLS e policy esplicite. Le tabelle con token, job, audit, mapping e dati shop devono restare server-side nel MVP.

## Compliance minima

Da implementare prima di beta reale:

- Shopify app uninstall webhook;
- Shopify GDPR webhook dove richiesti;
- cancellazione o anonimizzazione dati shop su richiesta;
- eBay marketplace account deletion notification oppure opt-out corretto;
- endpoint eBay account deletion predisposto: `/ebay/account-deletion`;
- verifica firma delle notifiche e cancellazione dati eBay prima di abilitare `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED=true`;
- privacy policy per custom app e futura app pubblica;
- audit log connect/disconnect/revoca/refresh fallito.

## Principio di minimizzazione

Conservare solo dati utili a:

- sync;
- conflitti;
- rollback;
- diagnostica;
- compliance.

Non salvare dati cliente o ordine oltre quanto serve a proteggere la disponibilità e agli obblighi provider.

## Incident response minima

1. Identificare provider coinvolto: Shopify, eBay, database, job queue o hosting.
2. Mettere in pausa sync se c'è rischio di modifica errata.
3. Proteggere stock con modalità prudente se necessario.
4. Ruotare segreti se c'è rischio esposizione.
5. Ripristinare da snapshot/rollback dove possibile.
6. Annotare incidente e correzione nella documentazione o changelog.
