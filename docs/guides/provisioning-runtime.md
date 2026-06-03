# Provisioning runtime

Questa guida traccia il provisioning minimo Vercel + Supabase e gli aggiornamenti post-scaffold.

Non contiene segreti reali. Password, token e connection string complete devono restare nei provider runtime o nel Keychain locale.

## Stato

Provisioning minimo completato il 2026-05-09.

Lo scaffold Shopify CLI React Router esiste. Esiste un deployment Vercel
production pronto. La pianificazione import può creare batch fino a 2.000
listing attivi o fermarsi prima quando lo store collegato ne espone meno; sul
dev store l'import reale ha completato 958 listing. Il runner copre import,
sync incrementale, update stock eBay da `orders/paid` nel pilota custom e
rilevazione conflitti Shopify. Il primo cambio quantità reale eBay -> Shopify
è stato verificato con rollback. Il runner stock Shopify -> eBay è stato
verificato con payload ordine sintetico e scrittura eBay reale allowlistata;
resta da verificare il trigger da vendita Shopify reale.

Lo schema Prisma iniziale include sessioni Shopify, shop installati, connessione eBay, state OAuth eBay, job applicativi, audit log, mapping prodotto, snapshot prodotto e conflitti Shopify. Le migration sono tracciate in `prisma/migrations/`.

## Vercel

| Campo             | Valore                                |
| ----------------- | ------------------------------------- |
| Scope             | `matteos-projects-9226d217`           |
| Project name      | `syncbay`                             |
| Project ID        | `prj_X9vkqDlE5t4QDUhOxE6m2aMFosiz`    |
| Root directory    | `.`                                   |
| Node.js           | `24.x` (`>=24.15`)                    |
| Framework         | `react-router`                        |
| Production domain | `https://syncbay.vercel.app`          |
| Ultimo deployment | `READY`                               |
| Link locale       | Creato in `.vercel/`, ignorato da Git |

Note:

- Il framework preset Vercel è `react-router`.
- Il build runtime esegue `prisma generate` prima di `react-router build`, così il Prisma Client resta coerente con `prisma/schema.prisma` anche quando Vercel riusa cache di installazione.
- Esiste un deployment production Vercel, ma non è ancora una release pubblica Shopify App Store.
- Gli env Vercel production e development sono stati impostati per Shopify, database, job, sicurezza e storage. Gli env preview restano da completare: la CLI Vercel ha richiesto uno scope di branch per il contesto Preview.
- Gli env eBay devono usare il keyset dedicato SyncBay, non keyset di altri progetti.
- Gli env eBay account deletion sono predisposti in Development e Production; `EBAY_ACCOUNT_DELETION_NOTIFICATIONS_ENABLED` resta controllato da flag e va abilitato solo dopo deploy/migration e test notification riuscita.
- `SYNCBAY_DRAFT_IMPORT_ENABLED=false` resta il default di sicurezza nel codice. Sul runtime pilota è riattivabile solo per import controllati da preview.
- `SYNCBAY_DRAFT_IMPORT_LIMIT` limita la dimensione dei batch `IMPORT_CATALOG`.
  Il runtime pilota è stato verificato a 50 prodotti con 26 nuove bozze e 24
  riusi senza duplicati sull'ultimo batch reale. La pianificazione import può
  creare più batch fino al minore tra listing attivi eBay e limite MVP di 2.000
  prodotti.
- `SYNCBAY_EBAY_STOCK_DRY_RUN=true` blocca le chiamate reali a eBay per i job
  `UPDATE_EBAY_STOCK`: il runner registra le riduzioni pianificate nel risultato
  del job, senza modificare la disponibilità eBay e senza scrivere snapshot di
  stock fittizi. In produzione pilota resta utile per ordini di prova; va
  riportato a `false` solo quando store, valuta e dati di test sono coerenti.
- `SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST` permette test reali mirati lasciando
  `SYNCBAY_EBAY_STOCK_DRY_RUN=true` per tutto il resto. Accetta token separati
  da virgola o spazio: `ebay:<ItemID>`, `<shopDomain>:<ItemID>`,
  `variant:<variantId>`, `variant:<variantGid>` o
  `<shopDomain>:variant:<variantId>`. Va lasciata vuota fuori dalla finestra di
  test e rimossa/ridotta appena verificato il job.
- Quando si aggiunge o rimuove `SYNCBAY_EBAY_STOCK_REAL_WRITE_ALLOWLIST` in
  Vercel production, ridistribuire production prima di creare il job di test e
  ridistribuire di nuovo dopo la rimozione. La verifica del 2026-06-02 ha usato
  una allowlist singola `ebay:<ItemID>`, poi ha confermato da `vercel env ls`
  che l'allowlist non fosse più presente.
- Per eBay.it i job `UPDATE_EBAY_STOCK` richiedono ordine Shopify e snapshot
  catalogo in `EUR`. Se la valuta manca o è diversa, la riga ordine viene
  saltata e non viene inviata nessuna mutation a eBay.
- Per misurare la quota reale eBay Trading usa
  `npm run ebay:rate-limits -- --shop syncbay-dev.myshopify.com`. Il comando
  legge i limiti applicativi e utente via Analytics API e mostra `limit`,
  `remaining`, `reset` e `timeWindow`. Se eBay segnala quota Trading esaurita,
  il runner non riprova ogni minuto: crea un marker `SYNC_INCREMENTAL` fallito e
  programma il prossimo enqueue dopo il reset giornaliero osservato, con
  override opzionale tramite `SYNCBAY_EBAY_TRADING_RATE_LIMIT_COOLDOWN_SECONDS`.
- `SYNCBAY_EBAY_FULL_RECONCILE_INTERVAL_SECONDS` può ridurre o aumentare la
  frequenza della riconciliazione completa Trading `GetMyeBaySelling`; se omesso
  resta giornaliera. Tra due riconciliazioni complete il runner usa
  `GetSellerEvents` per i delta e salva le candidate lette nel payload dei job,
  riducendo il consumo di `GetItem`.
- La creazione automatica di un ordine test via Shopify Admin GraphQL richiede
  `write_orders` e un token offline; `shopify store execute` con il token CLI
  disponibile non è sufficiente. Finché quello scope non è disponibile, la prova
  completa del trigger vendita Shopify reale resta separata dalla prova del
  runner stock.
- Prima di una prova reale `orders/paid`, usa
  `npm run orders:paid-readiness -- --shop syncbay-dev.myshopify.com`: il
  comando controlla in sola lettura sessione offline Shopify, scope
  `read_orders`/`write_orders`, coda stock/sync e candidati con snapshot `EUR`.
  Se segnala solo `write_orders` mancante, il runtime webhook può ricevere
  `orders/paid`, ma il test automatico via Admin `orderCreate` richiede
  reautorizzazione con quello scope o un ordine manuale nel dev store.
- Il runner automatico richiede sessioni Shopify offline a scadenza con
  `refreshToken`: le sessioni legacy senza `expires` non sono considerate sane
  perché le public app Shopify dovranno usare token offline a scadenza dal 1
  gennaio 2027. Se il refresh token manca o scade, riaprire l'app Shopify per
  ripetere il flusso di autorizzazione/migrazione; non usare token offline a
  durata illimitata come workaround.
- `/api/jobs/run-due` è il runner HTTP protetto da `CRON_SECRET` per riprendere job `IMPORT_CATALOG` dovuti. La schedule Supabase Cron `syncbay-run-due-jobs` è attiva ogni minuto e legge il secret da Supabase Vault, senza valore segreto in repo o documentazione. I retry reali recuperano i listing per `ItemID` via Trading API `GetItem` e chiudono il job originale senza lasciarlo `RUNNING`.
- Per diagnostica operativa dei job non usare `vercel env pull` come fonte di
  `DATABASE_URL` production: le variabili Vercel sensibili possono risultare
  non leggibili fuori runtime. Usa invece `npm run jobs:status -- --shop
syncbay-dev.myshopify.com`, che interroga Supabase remoto via `supabase db
query --linked`, usa `SUPABASE_DB_PASSWORD` o il Portachiavi macOS locale
quando disponibile e stampa solo stato job sanitizzato.
- Per ripristinare lo stock eBay dopo un test reale mirato usa
  `npm run stock:restore-ebay -- --item-id <ItemID> --quantity <n> --confirm-real-ebay-write`.
  Lo script rifiuta l'esecuzione se ci sono job stock/sync attivi, usa il token
  eBay cifrato senza stamparlo, verifica con Trading API `GetItem` e registra
  uno snapshot `SYNCBAY` di ripristino.
- Vercel Web Analytics e Speed Insights sono integrati nel root React; i dati vanno abilitati/letti dal dashboard Vercel dopo visite reali.
- Vercel Cron non è il meccanismo primario SyncBay: polling, queue drain e retry restano su Supabase Cron/Queues come da ADR 0005.

## Supabase

| Campo           | Valore                 |
| --------------- | ---------------------- |
| Organization ID | `dvparweojjzveymxscdy` |
| Project name    | `SyncBay`              |
| Project ref     | `mgjcbuokppfnglsftsmi` |
| Region          | `eu-west-1`            |
| Postgres        | `17.6`                 |
| Link locale     | `supabase/config.toml` |

La password database generata durante il provisioning è stata salvata nel Keychain macOS:

```text
service: syncbay-supabase-db-password
account: SyncBay
```

Non salvarla in Git e non stamparla nei log.

## Verifiche eseguite

- `vercel whoami`
- `vercel project inspect syncbay`
- `supabase projects list`
- `supabase link --project-ref mgjcbuokppfnglsftsmi`
- query remota Supabase: database `postgres`, versione `17.6`
- `npx prisma migrate deploy` iniziale su Supabase tramite pooler
- migration OAuth eBay applicata su Supabase con `supabase db query --linked` e registrazione in `_prisma_migrations`
- primitive Supabase runtime applicate con `supabase db query --linked`: `pgmq`, `pg_cron`, coda `syncbay_jobs`, bucket privato `syncbay-import-staging`
- schedule Supabase Cron `syncbay-run-due-jobs` applicata con `supabase db query --linked`; chiama `/api/jobs/run-due?limit=5` ogni minuto tramite `pg_net` e secret in Supabase Vault
- retry reale verificato sul dev store con job `IMPORT_CATALOG` in stato `RETRYING`: risposta HTTP `200`, riuso della bozza Shopify esistente e transizione finale del job originale a `SUCCEEDED`
- batch reale storico da 50 prodotti verificato sul dev store: job
  `IMPORT_CATALOG` `SUCCEEDED`, 50 listing gestiti, 26 nuove bozze Shopify, 24
  riusi senza duplicati e mapping presenti per tutti i 50 `ItemID`; il runner
  automatico corrente spezza comunque i job eBay -> Shopify sopra 10 ItemID per
  restare compatibile con la finestra cron/serverless.
- warning storico Supabase `extension_in_public` chiuso: `pg_net` ricreata nello schema `extensions`, funzioni `net.http_get`/`net.http_post` ancora disponibili e schedule `syncbay-run-due-jobs` ancora attiva
- advisor Supabase security/performance senza issue dopo abilitazione RLS su `_prisma_migrations`
- migration runtime primitives e mapping/snapshot/conflitti applicate su Supabase con `supabase db query --linked` e registrate in `_prisma_migrations`, perché `npx prisma migrate deploy` si fermava sul pooler con errore opaco dello schema engine
- verifica SQL remota: tabelle `ProductMapping`, `ProductSnapshot` e `SyncConflict` presenti con RLS attivo
- `shopify app dev --store syncbay-dev.myshopify.com` con preview Admin caricata e sessione installazione registrata
- test eBay -> Shopify su ItemID controllato `156986744184`: stock eBay 3 -> 2
  via Trading API, sync incrementale production, stock Shopify verificato a 2,
  rollback eBay/Shopify a 3
- test runner Shopify -> eBay su ItemID controllato `156986744184`: job
  `UPDATE_EBAY_STOCK` con payload ordine sintetico, `dryRun: true`,
  allowlist reale singola, `updatedCount: 1`, stock eBay 3 -> 2, rollback a 3,
  allowlist Vercel rimossa e production ridistribuita

Estensioni Supabase verificate:

| Estensione  | Stato                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `pgcrypto`  | Installata                                                                                             |
| `uuid-ossp` | Installata                                                                                             |
| `pgmq`      | Abilitata via migration Prisma                                                                         |
| `pg_cron`   | Abilitata via migration Prisma                                                                         |
| `pg_net`    | Installata nello schema `extensions`; funzioni `net.*` attive per le chiamate HTTP della schedule Cron |

Primitive Supabase tracciate:

- estensione `pgmq`;
- coda `syncbay_jobs`;
- estensione `pg_cron`;
- estensione `pg_net`;
- schedule `syncbay-run-due-jobs` ogni minuto per riprendere job `IMPORT_CATALOG` dovuti;
- bucket privato `syncbay-import-staging` per staging temporaneo immagini, usato
  per generare URL firmate quando Shopify rifiuta le URL immagine eBay dirette.

Scope Shopify richiesti dal pilota runtime:

- `read_products`, `write_products`;
- `read_inventory`, `write_inventory`;
- `read_locations`, `write_locations`;
- `read_publications`, `write_publications` per leggere i canali disponibili e
  pubblicare i prodotti attivi secondo la policy canali dello shop;
- `read_files`, `write_files` per riallineare media prodotto e rimuovere media
  precedenti gestiti da SyncBay.
- `read_orders` per ricevere `orders/paid` nel pilota custom e creare job
  prioritari `UPDATE_EBAY_STOCK`.
- `write_orders` per creare una prova automatica controllata via Admin
  `orderCreate` sul dev store; se manca dalla sessione offline, riaprire e
  autorizzare l'app Shopify dopo il deploy degli scope aggiornati.

La schedule Cron attuale richiama il runner `/api/jobs/run-due`, che drena
import catalogo, sync incrementale, rilevazione conflitti Shopify e job stock
eBay secondo priorità.

Per riallineare una tantum prodotti già mappati verso un canale Shopify
specifico usare:

```bash
npm run products:publish-channel -- --shop syncbay-dev.myshopify.com --publication-title "Online Store" --configure-settings
```

Eseguire prima con `--dry-run`; il comando usa `publishablePublish` sui
`ProductMapping` attivi e, con `--configure-settings`, salva la policy canali
dello shop su `SELECTED`.

## Cosa resta da fare

Durante o subito dopo lo scaffold:

- mantenere allineate le migration Prisma su Supabase Postgres;
- definire `DATABASE_URL` e `DATABASE_DIRECT_URL` nei provider, non nel repo;
- completare gli env Vercel preview quando viene scelto il branch target o via dashboard;
- verificare gli advisor Supabase con `npm run db:verify` quando le credenziali linked sono disponibili;
- aggiornare URL Shopify/eBay con il primo URL Vercel utilizzabile.
