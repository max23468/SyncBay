# Prerequisiti account Shopify ed eBay

Questa guida traccia il perimetro dei prerequisiti account per lo scaffold e le prime connessioni.

Non contiene segreti reali. I valori sensibili vanno inseriti solo nei provider/runtime corretti.

## Stato

Prerequisiti Shopify confermati e Shopify CLI collegata all'app `SyncBay`.

Prerequisiti eBay parzialmente confermati: account eBay Developer disponibile, nuovo keyset/app SyncBay richiesto a eBay e in attesa di approvazione. Restano da completare RuName, URL OAuth e requisiti account deletion quando il keyset sarà disponibile.

Finché non vengono forniti URL reali e keyset eBay approvato:

- non attivare OAuth eBay reale o sync runtime;
- non riusare keyset di altri progetti senza decisione esplicita;
- non salvare token o secret nel repo;
- non configurare webhook produttivi.

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
```

Da verificare durante l'evoluzione runtime:

- eventuali scope media/file se l'upload immagini passa da API che li richiedono;
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
| App/keyset eBay SyncBay | In attesa eBay | Richiesto keyset/app separato per SyncBay; non riusare FiscalBay salvo fallback esplicito. |
| Marketplace iniziale | Confermato | `EBAY_IT` |
| OAuth RuName Sandbox | In attesa keyset | eBay usa `RuName` come `redirect_uri` nel token exchange. |
| OAuth RuName Production | In attesa keyset | Separato dal Sandbox. |
| Accept URL | Da derivare da Vercel | URL pubblico/callback success OAuth. |
| Reject URL | Da derivare da Vercel | URL pubblico/callback rifiuto OAuth. |
| Scopes eBay | Definiti come bozza MVP | Da validare contro metodi effettivi usati. |
| Account deletion endpoint | Da derivare da Vercel | Richiede HTTPS pubblico e challenge response. |
| Verification token | Da generare fuori repo | 32-80 caratteri, non salvare in Git. |

### OAuth

SyncBay dovrà usare Authorization Code Grant per token utente venditore eBay.

Nota importante: nel token exchange eBay il parametro `redirect_uri` non è una normale URL applicativa, ma il `RuName` assegnato all'app eBay per l'ambiente Sandbox o Production.

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

Endpoint token:

- Sandbox: `https://api.sandbox.ebay.com/identity/v1/oauth2/token`
- Production: `https://api.ebay.com/identity/v1/oauth2/token`

### Scopes eBay MVP

Bozza iniziale:

```text
https://api.ebay.com/oauth/api_scope/sell.inventory.readonly
https://api.ebay.com/oauth/api_scope/sell.inventory
https://api.ebay.com/oauth/api_scope/commerce.notification.subscription
```

Da verificare in fase implementazione:

- metodi Trading API effettivamente usati per leggere listing storici;
- se servono scope aggiuntivi per Sell Feed, Metadata o Taxonomy;
- se la subscription notification e application-based o user-based.

Regola: Inventory API non copre necessariamente tutti i listing storici; Trading API resta prevista dove serve.

### Marketplace account deletion

Prima di usare l'app eBay in modo reale, SyncBay deve gestire correttamente marketplace account deletion.

Requisiti:

- endpoint HTTPS pubblico;
- no localhost o IP interno;
- verification token di 32-80 caratteri, alfanumerico con `_` e `-`;
- risposta alla challenge `GET ?challenge_code=...`;
- validazione delle notifiche ricevute;
- alternativa solo se eBay consente opt-out per il caso specifico.

Endpoint provvisorio futuro:

```text
https://<syncbay-vercel-host>/webhooks/ebay/account-deletion
```

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
- App/keyset eBay SyncBay: richiesto a eBay, in attesa di approvazione.
- Sandbox keyset: in attesa.
- Production keyset: in attesa.
- RuName Sandbox: da compilare quando eBay approva/mostra il keyset.
- RuName Production: da compilare quando disponibile.
- Accept URL e Reject URL: da definire dopo approvazione keyset eBay e conferma callback pubbliche.
- Preferenza iniziale: test su Sandbox quando disponibile; Production solo dopo decisione esplicita.

## Cosa resta bloccante

Anche con questa guida chiusa, prima delle prossime fasi runtime restano da completare:

- callback provider eBay reali;
- keyset/RuName eBay;
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
