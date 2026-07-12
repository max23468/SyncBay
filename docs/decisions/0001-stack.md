# ADR 0001 - Stack iniziale SyncBay

Data: 2026-05-09

## Stato

Accettato. Lo scaffold applicativo e il runtime pilota sono stati creati seguendo questa direzione; eventuali cambi di stack richiedono una nuova ADR o l'aggiornamento esplicito di questa decisione.

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
- Prisma come ORM iniziale, per coerenza con il template Shopify React Router.
  Nello stato corrente è applicato Prisma 7 con Prisma Config, adapter
  Postgres, client generato in path esplicito e link post-generate verso
  `@prisma/client`. Lo storage sessioni Shopify è locale perché il pacchetto
  Shopify prisma-specifico non è ancora compatibile con Prisma 7.
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

- Lo scaffold applicativo e il runtime pilota sono stati creati seguendo questa
  decisione; il vincolo ora è non cambiare stack, runtime o framework senza
  nuova decisione esplicita.
- I documenti restano framework-aware e devono riflettere i file generati reali
  quando descrivono superfici implementate.
- Prima di upgrade o cambi strutturali bisogna verificare versione Shopify CLI,
  template disponibile, requisiti account Shopify Partner/store pilota Numisleo e stato
  Vercel/Supabase effettivo.
- Il piano tecnico deve evitare riferimenti rigidi a Remix se la scelta corrente e React Router.
- I job devono essere progettati a batch piccoli, idempotenti e riprendibili; se i limiti serverless diventano stretti, il consumer queue potrà essere spostato su worker dedicato senza cambiare database o ORM.

## Fonti

- Shopify CLI per app: https://shopify.dev/docs/apps/build/cli-for-apps
- Shopify app templates/libraries: https://shopify.dev/docs/api/libraries-and-templates
- Shopify app structure: https://shopify.dev/docs/apps/build/cli-for-apps/app-structure
- Shopify Admin GraphQL `productSet`: https://shopify.dev/docs/api/admin-graphql/latest/mutations/productSet
- Infrastruttura runtime MVP: `docs/decisions/0005-runtime-infrastructure.md`
