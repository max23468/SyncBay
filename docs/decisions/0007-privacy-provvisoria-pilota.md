# ADR 0007 - Privacy provvisoria pilota

- **Stato**: Accettato
- **Data**: 2026-05-10
- **Decisori**: maintainer, Codex

## Contesto

SyncBay deve configurare un RuName eBay production e, più avanti, completare il flusso OAuth eBay. eBay richiede una URL HTTPS di privacy policy per il RuName.

Il prodotto è ancora in fase pilota: non esistono import catalogo, sync automatico, billing, pubblicazione Shopify App Store o onboarding pubblico. Serve quindi una pagina privacy pubblica minima e veritiera, sufficiente per configurazioni tecniche e pilota controllato, senza presentarla come policy legale definitiva per app pubblica.

Vincoli:

- non inserire segreti, token o dati reali nel repository;
- non promettere cifratura non ancora implementata;
- usare solo il keyset dedicato SyncBay per OAuth eBay;
- non abilitare notifiche account deletion reali prima di deploy/migration e test notification riuscita;
- sostituire questa policy prima di una beta pubblica, billing o Shopify App Store.

## Decisione

Manteniamo una pagina pubblica provvisoria in:

```text
https://syncbay.vercel.app/privacy
```

La pagina descrive solo il trattamento minimo previsto per il pilota: dati tecnici dello shop, catalogo eBay, token dei provider, log operativi, audit log, stato connessioni, import, sync, retry e diagnostica.

La sezione sicurezza deve restare aderente al runtime corrente:

- i segreti non vengono salvati nel repository;
- i token eBay persistiti da SyncBay vengono cifrati applicativamente;
- i token Shopify gestiti dallo storage sessioni del template Shopify non devono essere descritti come già cifrati applicativamente finché non viene modificato lo storage.

L'endpoint preparatorio per marketplace account deletion è:

```text
/ebay/account-deletion
```

La challenge `GET ?challenge_code=...` è supportata. Le notifiche `POST`
verificano `X-EBAY-SIGNATURE`, usano la public key eBay e rimuovono i dati
eBay collegati allo shop quando la notifica contiene un `userId` già associato a
una connessione SyncBay. Il flag `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED`
resta la protezione operativa prima di ricevere notifiche reali.

## Conseguenze

- Il RuName eBay può avere una URL privacy HTTPS stabile.
- La documentazione conserva il razionale della policy provvisoria.
- La pagina non sostituisce una privacy policy legale definitiva.
- Prima di app pubblica, beta aperta, billing o trattamento dati reali di negozianti non pilota serve una revisione privacy dedicata.

## Alternative considerate

- **Lasciare vuota la privacy URL eBay**: scartata perché fragile e non adatta a un RuName production.
- **Usare una privacy policy definitiva ora**: scartata perché prodotto, billing, support policy e flussi dati non sono ancora finali.
- **Promettere cifratura generica di tutti i token provider**: scartata perché oggi la cifratura applicativa è implementata per i token eBay persistiti da SyncBay, mentre lo storage sessioni Shopify segue il template.

## Riferimenti

- `app/routes/privacy.tsx`
- `docs/guides/prerequisiti-account.md`
- `docs/guides/sicurezza-privacy.md`
- eBay OAuth authorization code grant: https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
