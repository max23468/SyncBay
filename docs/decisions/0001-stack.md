# ADR 0001 - Stack iniziale SyncBay

Data: 2026-05-09

## Stato

Proposto e adottato come direzione iniziale, da rivalutare solo prima dello scaffold applicativo se Shopify o vincoli deploy richiedono modifiche.

## Contesto

SyncBay deve essere una Shopify app con dashboard embedded, autenticazione Shopify, OAuth eBay, sync catalogo, job asincroni, webhook, database persistente e code.

Il progetto deve partire come custom app per pilota controllato e poi poter evolvere verso app pubblica Shopify App Store.

La documentazione Shopify corrente indica Shopify CLI come percorso standard per creare app e gestire struttura/configurazione. Le fonti Shopify più recenti indicano il template React Router come raccomandato per la maggior parte delle nuove app, mentre molta documentazione storica e pacchetti esistenti fanno ancora riferimento a Remix.

## Decisione

Usare uno stack TypeScript/Node basato su Shopify CLI e template ufficiale React Router al momento dello scaffold applicativo.

Componenti previsti:

- Shopify CLI per generazione e gestione configurazione app.
- React Router app template ufficiale Shopify.
- TypeScript.
- Shopify Admin GraphQL per prodotti, inventario, media e webhook.
- Supabase Postgres come database applicativo.
- Prisma come ORM iniziale, per coerenza con il template Shopify React Router e lo storage sessioni.
- Supabase Queues come job queue persistente per import, sync, retry e stock update.
- Supabase Cron come scheduler primario per polling e drenaggio queue.
- Vercel come hosting dell'app embedded, backend HTTP, OAuth e webhook.
- Supabase Storage come staging privato e temporaneo per immagini quando serve.

## Alternative considerate

### Remix template storico

Vantaggio: molta documentazione ed esempi Shopify esistenti usano Remix.

Motivo per non sceglierlo ora: la documentazione Shopify più recente sulle librerie/template indica React Router come template raccomandato per la maggior parte delle nuove app.

### Next.js custom

Vantaggio: ecosistema ampio e deploy semplice.

Motivo per non sceglierlo ora: per una Shopify app embedded conviene seguire il percorso ufficiale Shopify CLI, riducendo attrito su auth, config, App Bridge e review futura.

## Implicazioni

- Non si crea codice applicativo finché lo scaffold non viene richiesto esplicitamente.
- I documenti restano framework-aware ma non dipendono ancora da file generati.
- Prima dello scaffold bisogna verificare versione Shopify CLI, template disponibile, requisiti account Shopify Partner/dev store e provisioning Vercel/Supabase.
- Il piano tecnico deve evitare riferimenti rigidi a Remix se la scelta corrente e React Router.
- I job devono essere progettati a batch piccoli, idempotenti e riprendibili; se i limiti serverless diventano stretti, il consumer queue potrà essere spostato su worker dedicato senza cambiare database o ORM.

## Fonti

- Shopify CLI per app: https://shopify.dev/docs/apps/build/cli-for-apps
- Shopify app templates/libraries: https://shopify.dev/docs/api/libraries-and-templates
- Shopify app structure: https://shopify.dev/docs/apps/build/cli-for-apps/app-structure
- Shopify Admin GraphQL `productSet`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
- Infrastruttura runtime MVP: `docs/decisions/0005-runtime-infrastructure.md`
