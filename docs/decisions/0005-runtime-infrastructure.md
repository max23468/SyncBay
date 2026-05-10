# ADR 0005 - Infrastruttura runtime MVP

- **Stato**: Accettato
- **Data**: 2026-05-09
- **Decisori**: maintainer, Codex

## Contesto

SyncBay deve diventare una Shopify app embedded con backend HTTP, OAuth Shopify/eBay, webhook pubblici, job asincroni, sync entro massimo 5 minuti, import fino a 2.000 prodotti per shop e token provider cifrati a riposo.

Il repository è ancora in fase documentale: questa decisione chiude i blocchi tecnici prima dello scaffold, ma non crea runtime, deploy, database o CI.

Vincoli principali:

- seguire il percorso Shopify CLI + template ufficiale React Router deciso in ADR 0001;
- mantenere stack TypeScript/Node;
- usare PostgreSQL;
- avere job persistenti, idempotenti e riprendibili;
- evitare worker lunghi o fragili nel percorso request/response;
- non legarsi a un'infrastruttura che renda difficile aggiungere un worker dedicato se il sync cresce.

## Decisione

Per l'MVP/pilota SyncBay userà:

- **Vercel** come hosting dell'app Shopify embedded, backend HTTP, endpoint OAuth e webhook;
- **Vercel Web Analytics e Speed Insights** come baseline di osservabilità e performance;
- **Supabase Postgres** come database applicativo;
- **Prisma** come ORM iniziale;
- **Supabase Queues** come coda persistente per import, sync, retry e update stock;
- **Supabase Cron** come scheduler primario per polling e drenaggio queue;
- **Supabase Storage** come staging privato e temporaneo per immagini solo quando il trasferimento diretto verso Shopify non basta;
- cifratura applicativa dei token Shopify/eBay prima del salvataggio su Postgres, con `TOKEN_ENCRYPTION_KEY` custodita come secret di runtime.

## Regole operative

### Hosting e app URL

Vercel ospiterà l'app web e gli endpoint pubblici.

Gli URL reali verranno decisi quando verrà creato il progetto Vercel:

- app URL Shopify;
- redirect URL Shopify;
- OAuth accept/reject URL eBay;
- endpoint eBay marketplace account deletion;
- webhook pubblici.

Non usare Vercel Cron come meccanismo primario per il sync entro 5 minuti. Su piani Vercel non adatti, i cron frequenti possono essere limitati; il polling applicativo resta affidato a Supabase Cron.

Vercel Analytics e Speed Insights sono ammessi per metriche aggregate di pagina
e performance. Non inviare eventi custom contenenti dati di negoziante,
inserzioni, ordini, clienti, importi, SKU o payload provider senza una nuova
decisione privacy/prodotto.

### Database e ORM

Supabase Postgres è il database primario.

Prisma è l'ORM iniziale perché il template Shopify React Router usa già Prisma per lo storage sessioni e riduce l'attrito dello scaffold.

Quando verrà creato lo scaffold:

- sostituire l'eventuale SQLite iniziale del template con Supabase Postgres;
- usare env separate per connection pooling runtime e connection diretta migration se necessarie;
- non esporre tabelle operative a client pubblici senza RLS e policy esplicite.

### Queue e scheduler

Supabase Queues è la coda persistente per:

- import catalogo;
- sync incrementale;
- retry API;
- update stock eBay dopo ordini Shopify;
- archiviazione prodotti chiusi;
- riconciliazione periodica.

Supabase Cron deve attivare worker brevi e frequenti per:

- creare job di polling;
- drenare queue a batch;
- riprendere job interrotti;
- eseguire cleanup di staging immagini e job scaduti.

Ogni job deve essere:

- idempotente;
- piccolo;
- riprendibile;
- tracciato su database;
- dotato di retry/backoff;
- associato a diagnostica leggibile in dashboard.

La prima baseline tecnica abilita `pgmq`, la coda `syncbay_jobs`, `pg_cron` e
il bucket privato `syncbay-import-staging`. Le schedule cron e il consumer queue
restano fuori finché non esiste la logica import/sync da eseguire.

### Storage immagini

Default: copiare le immagini finali su Shopify e non dipendere stabilmente dagli URL eBay.

Supabase Storage va usato solo come staging privato temporaneo quando serve:

- download intermedio;
- retry upload;
- deduplica/hash;
- quarantena di asset problematici.

Lo staging deve avere retention breve e cleanup automatico. Non salvare immagini o dati reali in fixture, screenshot o documentazione.

### Segreti e token

I secret di piattaforma restano nei provider runtime:

- Vercel env secrets per app e backend;
- Supabase project secrets quando si useranno funzioni o servizi Supabase;
- nessun secret reale nel repo.

I token OAuth per shop/account devono essere cifrati applicativamente prima del salvataggio in Postgres. La cifratura at-rest del provider database non sostituisce questa regola.

### Strategia webhook locali

Per sviluppo Shopify locale:

- usare Shopify CLI e il tunnel gestito dal flusso `shopify app dev` quando disponibile;
- mantenere `shopify.app.toml` allineato allo stato dell'app.

Per eBay:

- preferire URL Vercel stabile appena esiste runtime deployato;
- evitare callback dinamiche o localhost per RuName, accept/reject URL e account deletion.

## Conseguenze

- Il percorso MVP resta snello e vicino allo stack già familiare GitHub + Vercel + Supabase.
- Si evita un worker sempre acceso nella prima fase.
- I job devono essere progettati con batch piccoli; import lunghi o sync pesanti non possono dipendere da una singola funzione lunga.
- La futura CI/runtime dovrà verificare anche migration, queue, cron e storage.
- La creazione effettiva di progetti Vercel/Supabase resta un passo separato di provisioning.

## Exit strategy

Se durante lo scaffold o il pilota i job serverless non bastano, mantenere:

- Vercel per app embedded e endpoint HTTP;
- Supabase Postgres;
- Supabase Queues;
- Prisma;
- modello dati e diagnostica.

Spostare solo il consumer della queue su un worker dedicato Render o Fly.io. Questa migrazione non deve richiedere cambio database, cambio ORM o riscrittura del dominio sync.

## Alternative considerate

- **Render web + background worker + Supabase Postgres**: più robusto per worker continui e job lunghi, ma introduce più gestione operativa già nel MVP. Tenuto come fallback/exit strategy.
- **Fly.io app + worker Machines + Supabase Postgres**: flessibile e adatto a processi dedicati, ma più operativo da gestire per una prima custom app pilota.
- **Solo Vercel Cron/Functions**: scartato come meccanismo primario di sync perché il polling frequente e i job lunghi dipendono troppo da limiti di piano e durata funzione.
- **Supabase Edge Functions come worker principale**: utili per endpoint brevi, ma non sono il default per job pesanti o lunghi. Meglio queue + cron + batch piccoli.
- **Drizzle al posto di Prisma**: valido tecnicamente, ma Prisma riduce attrito con il template Shopify React Router e lo storage sessioni iniziale.

## Riferimenti

- `docs/decisions/0001-stack.md`
- `docs/decisions/0004-runtime-ci-release-future.md`
- `docs/guides/pre-scaffold-checklist.md`
- `docs/guides/sync-engine.md`
- `docs/guides/sicurezza-privacy.md`
- Shopify deployment: https://shopify.dev/docs/apps/launch/deployment/deploy-web-app/deploy-to-hosting-service
- Shopify React Router scaffold: https://shopify.dev/docs/apps/build/scaffold-app
- Vercel React Router: https://vercel.com/docs/frameworks/frontend/react-router
- Vercel Cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Supabase Queues: https://supabase.com/docs/guides/queues
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Storage: https://supabase.com/docs/guides/storage
