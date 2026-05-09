# Prerequisiti account Shopify ed eBay

Questa guida chiude il perimetro dei prerequisiti account prima dello scaffold applicativo.

Non contiene segreti reali. I valori sensibili vanno inseriti solo nei provider/runtime corretti quando esistera lo scaffold.

## Stato

Prerequisiti definiti, valori reali da confermare con il maintainer.

Finche non vengono forniti account e URL reali:

- non creare app Shopify CLI;
- non creare app eBay production;
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
| App URL locale/provvisoria | Da decidere | Deve essere HTTPS quando Shopify/eBay chiamano l'app. |
| Redirect URL OAuth | Da decidere | Da derivare dall'app URL dopo scelta hosting/tunnel. |
| Scopes iniziali | Definiti come bozza MVP | Da validare sul template Shopify/API version al momento dello scaffold. |
| Webhook minimi | Definiti come bozza MVP | Da registrare via config Shopify CLI dove possibile. |

### App e URL

Default operativo per lo scaffold:

- usare Shopify CLI;
- collegare una app `SyncBay` nel Dev Dashboard;
- usare il development store `syncbay-dev.myshopify.com`;
- usare un URL HTTPS provvisorio per sviluppo, tramite tunnel/hosting deciso;
- tenere separati URL locali/provvisori e URL production futura.

URL previsti appena esistera runtime:

| Uso | Pattern provvisorio |
| --- | --- |
| App URL | `https://<syncbay-dev-host>` |
| Shopify OAuth callback | `https://<syncbay-dev-host>/auth/shopify/callback` |
| Shopify webhook endpoint | `https://<syncbay-dev-host>/webhooks/shopify` |

I path sono provvisori: lo scaffold Shopify potrebbe generarne di diversi.

### Scopes Shopify MVP

Bozza iniziale:

```text
read_products
write_products
read_inventory
write_inventory
read_orders
read_locations
```

Da verificare in fase scaffold:

- eventuali scope media/file se l'upload immagini passa da API che li richiedono;
- se `read_orders` e sufficiente per il trigger scelto o se servono accessi aggiuntivi;
- requisiti esatti dei webhook e della versione Admin API usata.

Regola: chiedere solo scope necessari al flusso MVP.

### Webhook Shopify MVP

Bozza minima:

| Evento | Perche serve |
| --- | --- |
| App uninstall | Fermare sync, revocare accessi, gestire cleanup. |
| Order paid o order created | Ridurre disponibilita eBay dopo vendita Shopify. |
| Product update | Rilevare modifiche manuali Shopify e aprire conflitti. |
| Inventory level update | Rilevare variazioni quantita manuali o esterne. |
| GDPR/compliance topics | Necessari prima di app pubblica e per gestione dati. |

Default MVP:

- trigger stock principale: ordine pagato;
- opzione futura/aggressiva: ordine creato;
- app-specific subscriptions via configurazione Shopify CLI quando supportato;
- fallback GraphQL Admin API se la subscription deve dipendere dallo shop.

## eBay

### Cosa serve

| Campo | Stato | Note |
| --- | --- | --- |
| Account eBay Developer | Da confermare | Necessario per ottenere keyset OAuth. |
| App eBay | Da creare o confermare | Servono Sandbox e Production se si vuole test completo. |
| Marketplace iniziale | Confermato | `EBAY_IT` |
| OAuth RuName Sandbox | Da confermare | eBay usa `RuName` come `redirect_uri` nel token exchange. |
| OAuth RuName Production | Da confermare | Separato dal Sandbox. |
| Accept URL | Da decidere | URL pubblico/callback success OAuth. |
| Reject URL | Da decidere | URL pubblico/callback rifiuto OAuth. |
| Scopes eBay | Definiti come bozza MVP | Da validare contro metodi effettivi usati. |
| Account deletion endpoint | Da decidere | Richiede HTTPS pubblico e challenge response. |
| Verification token | Da generare fuori repo | 32-80 caratteri, non salvare in Git. |

### OAuth

SyncBay dovra usare Authorization Code Grant per token utente venditore eBay.

Nota importante: nel token exchange eBay il parametro `redirect_uri` non e una normale URL applicativa, ma il `RuName` assegnato all'app eBay per l'ambiente Sandbox o Production.

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
https://<syncbay-dev-host>/webhooks/ebay/account-deletion
```

## Dati che il maintainer deve fornire

### Shopify

- Conferma account Shopify Partner disponibile: si/no.
- Development store da usare: `<shop>.myshopify.com`.
- Nome app custom: confermare `SyncBay` o indicare variante.
- App URL provvisorio, se gia deciso.
- Preferenza tunnel/hosting dev, se gia decisa.

### eBay

- Conferma account eBay Developer disponibile: si/no.
- App eBay gia creata: si/no.
- Sandbox keyset disponibile: si/no.
- Production keyset disponibile: si/no.
- RuName Sandbox.
- RuName Production, se gia disponibile.
- Accept URL e Reject URL desiderate, oppure conferma che le definiamo dopo hosting.
- Preferenza iniziale: solo Sandbox o Sandbox + Production.

## Cosa resta bloccante

Anche con questa guida chiusa, prima dello scaffold restano da decidere:

- hosting/app URL;
- strategia tunnel/webhook locali;
- database;
- ORM;
- job queue;
- storage temporaneo immagini;
- cifratura token a riposo.

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
