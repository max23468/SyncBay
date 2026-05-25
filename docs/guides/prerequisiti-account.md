# Prerequisiti account Shopify ed eBay

Questa guida traccia il perimetro dei prerequisiti account per lo scaffold e le prime connessioni.

Non contiene segreti reali. I valori sensibili vanno inseriti solo nei provider/runtime corretti.

## Stato

Prerequisiti Shopify confermati e Shopify CLI collegata all'app `SyncBay`.

Prerequisiti eBay parzialmente confermati: account eBay Developer disponibile e keyset/app dedicato SyncBay ricevuto. Restano da completare deploy runtime aggiornato, flag runtime e verifica OAuth/account deletion end-to-end prima di collegare letture listing reali.

Finché OAuth e account deletion non sono verificati sul runtime aggiornato:

- non attivare sync runtime;
- non riusare keyset di altri progetti;
- non salvare token o secret nel repo;
- non abilitare notifiche eBay reali senza migration/deploy e test notification riuscita.

## Shopify

### Cosa serve

| Campo | Stato | Note |
| --- | --- | --- |
| Account Shopify Partner | Confermato | Login CLI: `matteofilisina@icloud.com`. |
| Development store | Confermato | `syncbay-dev.myshopify.com` |
| Nome app custom | Confermato | `SyncBay` |
| Shopify CLI | Collegata | `shopify.app.toml` collegato all'app `SyncBay`. |
| App URL locale/provvisoria | Provider creato | Vercel project `syncbay`; dev preview verificata via Shopify CLI. |
| Redirect URL OAuth | Definito per Shopify | `https://syncbay.vercel.app/auth/callback` nel manifest pilota. |
| Scopes iniziali | Definiti e ridotti | Nessun `read_orders` finché Shopify protected customer data non viene configurato. |
| Webhook minimi | Parzialmente configurati | `orders/paid` preparato lato route ma non sottoscritto nel manifest. |

### App e URL

Default operativo per lo scaffold:

- usare Shopify CLI;
- collegare una app `SyncBay` nel Dev Dashboard;
- usare il development store `syncbay-dev.myshopify.com`;
- usare Vercel come URL HTTPS stabile per sviluppo condiviso e callback provider quando serve un host pubblico;
- usare Shopify CLI tunnel per sviluppo locale Shopify quando supportato;
- tenere separati URL locali/provvisori e URL production futura.

URL previsti per il primo deploy Vercel:

| Uso | Pattern provvisorio |
| --- | --- |
| App URL | `https://<syncbay-vercel-host>` |
| Shopify OAuth callback | `https://<syncbay-vercel-host>/auth/shopify/callback` |
| Shopify webhook endpoint | `https://<syncbay-vercel-host>/webhooks/shopify` |

I path Shopify restano allineati allo scaffold generato.

### Scopes Shopify MVP

Bozza iniziale:

```text
read_products
write_products
read_inventory
write_inventory
read_locations
write_locations
```

Da verificare durante l'evoluzione runtime:

- eventuali scope media/file se l'upload immagini passa da API che li richiedono;
- mantenere `write_locations` solo se SyncBay gestisce davvero rename o metadati della location dal runtime app;
- `read_orders` solo dopo configurazione Shopify per protected customer data;
- requisiti esatti dei webhook e della versione Admin API usata.

Regola: chiedere solo scope necessari al flusso MVP.

### Webhook Shopify MVP

Bozza minima:

| Evento | Perché serve |
| --- | --- |
| App uninstall | Fermare sync, revocare accessi, gestire cleanup. |
| Inventory level update | Trigger iniziale per rilevare variazioni quantità senza protected customer data. |
| Order paid o order created | Trigger futuro per ridurre disponibilità eBay dopo vendita Shopify, dopo configurazione protected customer data. |
| Product update | Rilevare modifiche manuali Shopify e aprire conflitti. |
| GDPR/compliance topics | Necessari prima di app pubblica e per gestione dati. |

Default MVP:

- trigger stock principale iniziale: variazione inventario;
- trigger stock ordine pagato: da attivare dopo configurazione protected customer data;
- opzione futura/aggressiva: ordine creato;
- app-specific subscriptions via configurazione Shopify CLI quando supportato;
- fallback GraphQL Admin API se la subscription deve dipendere dallo shop.

## eBay

### Cosa serve

| Campo | Stato | Note |
| --- | --- | --- |
| Account eBay Developer | Confermato | Account disponibile. |
| App/keyset eBay SyncBay | Ricevuto | Usare solo il keyset dedicato SyncBay; non riusare keyset di altri progetti. |
| Marketplace iniziale | Confermato | `EBAY_IT` |
| OAuth RuName Sandbox | Da verificare | eBay usa `RuName` come `redirect_uri` nel token exchange. |
| OAuth RuName Production | Da verificare end-to-end | Il valore resta negli env, non nel repo. |
| Accept URL | Confermata | `https://syncbay.vercel.app/auth/ebay/callback` |
| Reject URL | Confermata | `https://syncbay.vercel.app/auth/ebay/callback` |
| Scopes eBay | Minimo MVP definito | Identity readonly + Inventory readonly/write. |
| Account deletion endpoint | Configurato | `https://syncbay.vercel.app/ebay/account-deletion` |
| Verification token | Configurato fuori repo | 32-80 caratteri, non salvare in Git. |

### OAuth

SyncBay dovrà usare Authorization Code Grant per token utente venditore eBay.

Nota importante: nel token exchange eBay il parametro `redirect_uri` non è una normale URL applicativa, ma il `RuName` assegnato all'app eBay per l'ambiente Sandbox o Production.

Stato 2026-05-25: il keyset dedicato SyncBay è disponibile. Il flusso OAuth lato app scambia il codice, cifra i token e legge il `userId` immutabile con Identity API per poter applicare correttamente eventuali notifiche marketplace account deletion. La verifica end-to-end resta da eseguire sul runtime aggiornato.

Valori previsti:

| Uso | Nome env futuro |
| --- | --- |
| Client ID | `EBAY_CLIENT_ID` |
| Client Secret | `EBAY_CLIENT_SECRET` |
| RuName | `EBAY_RU_NAME` |
| Ambiente | `EBAY_ENVIRONMENT` |
| Marketplace | `EBAY_MARKETPLACE_ID=EBAY_IT` |
| Accept URL | `EBAY_OAUTH_ACCEPT_URL` |
| Reject URL | `EBAY_OAUTH_REJECT_URL` |
| Flag abilitazione OAuth | `EBAY_OAUTH_ENABLED=true` solo quando il runtime è pronto per il test end-to-end |

Endpoint token:

- Sandbox: `https://api.sandbox.ebay.com/identity/v1/oauth2/token`
- Production: `https://api.ebay.com/identity/v1/oauth2/token`

### Scopes eBay MVP

Bozza iniziale:

```text
https://api.ebay.com/oauth/api_scope/commerce.identity.readonly
https://api.ebay.com/oauth/api_scope/sell.inventory.readonly
https://api.ebay.com/oauth/api_scope/sell.inventory
```

- metodo Trading API usato per leggere listing storici: `GetMyeBaySelling`
  via OAuth user access token e header `X-EBAY-API-IAF-TOKEN`; le API
  tradizionali eBay non usano scope OAuth propri;
- se servono scope aggiuntivi per Sell Feed, Metadata o Taxonomy;
- se in futuro serve gestire subscription Notification API via API invece che dal portale.

Regola: Inventory API non copre necessariamente tutti i listing storici; Trading API resta il fallback di lettura dove serve.

### Marketplace account deletion

Prima di usare l'app eBay in modo reale, SyncBay deve gestire correttamente marketplace account deletion.

Requisiti:

- endpoint HTTPS pubblico;
- no localhost o IP interno;
- verification token di 32-80 caratteri, alfanumerico con `_` e `-`;
- risposta alla challenge `GET ?challenge_code=...`;
- validazione delle notifiche ricevute;
- alternativa solo se eBay consente opt-out per il caso specifico.

Endpoint predisposto:

```text
https://syncbay.vercel.app/ebay/account-deletion
```

Stato implementazione:

- `GET ?challenge_code=...` calcola la `challengeResponse` richiesta da eBay usando `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN` e `EBAY_ACCOUNT_DELETION_ENDPOINT_URL`.
- `POST` verifica `X-EBAY-SIGNATURE`, recupera e cache-a la public key eBay e risponde `204` quando la notifica è valida e processata.
- La notifica viene associata a `EbayConnection.ebayUserId`; per gli shop corrispondenti SyncBay revoca la connessione eBay, azzera token/user id, cancella mapping, snapshot, conflitti e payload job collegati al catalogo eBay.
- SyncBay registra solo audit minimizzato e `hashedUserId`, senza salvare username, eiasToken o payload raw.
- `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED` resta il flag di sicurezza: abilitarlo solo dopo migration/deploy e test notification riuscita.

## Dati che il maintainer deve fornire

### Shopify

- Account Shopify Partner: confermato.
- Development store: `syncbay-dev.myshopify.com`.
- Nome app custom: `SyncBay`.
- Shopify CLI: collegata all'app `SyncBay`.
- App URL provvisorio: `https://syncbay.vercel.app` nel manifest pilota; dev preview verificata via Shopify CLI.
- Preferenza tunnel/hosting dev: Vercel per URL stabile, Shopify CLI tunnel per sviluppo locale Shopify.

### eBay

- Account eBay Developer: confermato.
- App/keyset eBay SyncBay: ricevuto, dedicato a SyncBay.
- Sandbox keyset: da verificare se necessario per test non production.
- Production keyset: disponibile; valori custoditi negli env/provider.
- RuName Sandbox: da verificare se si usa Sandbox.
- RuName Production: da verificare end-to-end; valore custodito negli env.
- Accept URL e Reject URL: confermate su `https://syncbay.vercel.app/auth/ebay/callback`.
- Preferenza iniziale: test su Sandbox quando disponibile; Production solo dopo decisione esplicita.

## Cosa resta bloccante

Anche con questa guida chiusa, prima delle prossime fasi runtime restano da completare:

- deploy runtime aggiornato e migration account deletion;
- test notification eBay account deletion;
- OAuth eBay end-to-end sul keyset dedicato;
- secret runtime nei provider, non nel repo.

## Fonti

- Shopify dev store: https://shopify.dev/docs/apps/build/dev-dashboard/development-stores
- Shopify CLI apps: https://shopify.dev/docs/apps/build/cli-for-apps
- Shopify app config: https://shopify.dev/docs/apps/build/cli-for-apps/manage-app-config-files
- Shopify webhooks: https://shopify.dev/docs/apps/build/webhooks/subscribe
- eBay OAuth authorization code grant: https://developer.ebay.com/api-docs/static/oauth-authorization-code-grant.html
- eBay OAuth token exchange: https://developer.ebay.com/api-docs/static/oauth-auth-code-grant-request.html
- eBay OAuth scopes: https://developer.ebay.com/api-docs/static/oauth-scopes.html
- eBay Inventory API scope example: https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
- eBay Notification API: https://developer.ebay.com/api-docs/commerce/notification/overview.html
- eBay marketplace account deletion: https://developer.ebay.com/develop/guides-v2/marketplace-user-account-deletion
