# Comandi di diagnostica e manutenzione

Questa guida raccoglie prerequisiti, guardie e modalità apply dei comandi
operativi elencati in `docs/TOOLCHAIN.md`. Consultala solo per diagnostica o
manutenzione live; la tabella dei comandi e i gate restano nella toolchain.

`npm run db:storage-budget` misura lo spazio fisico del database e confronta il
risultato con il budget configurato. `npm run storage:budget` misura byte e
numero degli oggetti Supabase Storage dalla tabella aggregata `storage.objects`;
è una fotografia live, mentre il contatore fatturabile del provider usa la
media in GB-ore. `npm run provider:budget` aggrega i budget operativi dei
provider senza stampare credenziali. Usa
`npm run product-baselines:backfill -- --dry-run` prima di popolare baseline
prodotto mancanti e `npm run history:maintain -- --dry-run` prima della
maintenance della storia; le scritture richiedono i flag di conferma previsti
dai rispettivi script.

La retention cancella i record scaduti ma Postgres non restituisce le pagine al
filesystem: dopo una cancellazione massiva le tabelle restano grandi e gli
indici gonfi. Il segnale è `tableSizeBytes` nel risultato della maintenance
giornaliera (`MaintenanceRun.result`) confrontato con le righe vive: quando il
peso resta alto mentre le righe calano, lo spazio è occupato da bloat. In quel
caso usa `REINDEX TABLE CONCURRENTLY "<Tabella>"` sulle tabelle calde
(`AuditLog`, `SyncJob`, `ProductSnapshot`): è un intervento occasionale e
opportunistico, non schedulato, che non prende lock esclusivi e può girare con
l'app attiva. Non serve toccare autovacuum, che riusa già le pagine liberate.
`VACUUM FULL` recupera anche l'heap ma prende un lock esclusivo e richiede
spazio disco temporaneo pari alla tabella: resta fuori dalla maintenance
automatica (ADR 0018) e va valutato caso per caso in finestra controllata.

Per Vercel, `provider:budget` seleziona il team tramite API documentata, usa il
piano conservativo dichiarato in `VERCEL_PLAN`, prova `vercel usage`, legge Web
Analytics sugli ultimi 30 giorni e i data point Speed Insights disponibili.
Sul piano Hobby `vercel usage` può
risultare `not_applicable` perché non esiste un ciclo di fatturazione; Speed
Insights è `partial` per la retention di 7 giorni. Fast Data Transfer e
metriche Functions sono `provider_locked` quando la CLI richiede Observability
Plus e devono essere controllate nel dashboard Usage. La quota Web Analytics è
di team, quindi la lettura usa tutti i progetti del team; Speed Insights resta
di progetto. La REST API documentata non espone il piano: il default di
repository è `hobby` e va verificato nel dashboard e aggiornato tramite
`VERCEL_PLAN` quando il piano cambia. Il report misura quote e consumi tecnici;
non applica un gate separato basato sulla classificazione dell'uso.

Per Supabase, lo storage file live è osservato via SQL aggregato. Il piano
organizzazione e l'egress unificato esatto restano `dashboard_required` perché
la CLI non espone il contatore fatturabile; `egress:budget` continua a fornire
il proxy diagnostico basato sulle righe senza inventare byte delle risposte.

`npm run db:verify` richiede progetto Supabase linked e credenziali disponibili.
Quando il comando gira da una worktree che non contiene `supabase/.temp`, gli
script cercano automaticamente una worktree dello stesso repo già linkata; puoi
forzare il checkout Supabase con
`SYNCBAY_SUPABASE_CWD=/Users/Matteo/Progetti/SyncBay npm run db:verify`. La
stessa risoluzione viene usata dagli script Supabase in sola lettura, incluso
`npm run conflicts:doctor`. Le migration remote vanno applicate esplicitamente
con `npx prisma migrate deploy` o, se il pooler blocca Prisma, con la procedura
documentata in `docs/guides/provisioning-runtime.md`.
Con Prisma 7, `prisma/schema.prisma` non contiene più `url` o `directUrl`:
`prisma.config.ts` usa `DATABASE_DIRECT_URL` per la CLI/migration quando
presente e ricade su `DATABASE_URL`. Il client generato vive in
`prisma/generated/client`, non va committato e viene rigenerato da
`npm run prisma:generate`, `pretypecheck` e `prebuild`.
Il pacchetto `prisma` (CLI) vive in `devDependencies`: serve solo a generate e
migration lanciate da build e tooling locali, mai dal runtime Vercel. Lo
script `npm run prisma:generate` esegue `prisma generate` e poi
`scripts/link-prisma-client.mjs` per collegare il client generato al wrapper
`@prisma/client`.
Nel runtime Vercel il normalizzatore Prisma aggiunge `uselibpqcompat=true`
solo per host Postgres Supabase (`db.*.supabase.co` o
`*.pooler.supabase.com`) quando la URL usa `sslmode=require`, così `pg`
mantiene TLS attivo sul pooler senza trattare la catena certificati Supabase
come `verify-full`. Gli altri provider Postgres conservano la propria semantica
TLS, salvo opt-in esplicito tramite parametro già presente nella URL.
`npm run audit:prod` esegue `npm audit --omit=dev` e blocca qualunque
vulnerabilità production segnalata da npm. Le eccezioni temporanee devono
essere rimosse appena coperte da override, aggiornamenti o fix upstream.
`npm run supabase:services` verifica PostgREST, Auth e Storage via HTTP con
anon/publishable key Supabase, senza stampare chiavi. Serve a distinguere un
errore locale di chiamata anonima (`401 missing_api_key`) da restrizioni reali
del progetto, per esempio `402 exceed_egress_quota`.
`npm run doctor:local` verifica toolchain Node/npm, `engine-strict`, file base
e presenza delle env SyncBay senza stampare valori sensibili. Usa
`--strict-env` quando stai preparando runtime live locale e vuoi bloccare anche
su env mancanti.
`npm run review:pre-pr` genera una self-review mirata del diff prima
dell'apertura o sincronizzazione della PR. Legge `origin/main...HEAD` di default
e include eventuali file staged/unstaged; suggerisce domande e verifiche in base
alle aree toccate, per anticipare i commenti Codex prevedibili prima del
preflight remoto.
`npm run publish:preflight` controlla branch, worktree, changelog e script
minimi prima della pubblicazione; con `--remote` verifica anche PR GitHub e i
review thread Codex della PR corrente. La `Codex feedback inbox` resta
dashboard/fallback globale: thread actionable su altre PR generano avvisi, non
bloccano la pubblicazione corrente.
`npm run perf:loaders` legge i log Vercel `syncbay-loader-performance` e stampa
l'ultimo tempo osservato per Panoramica, Catalogo, Importazione, Attività,
Conflitti e Impostazioni. Procedura consigliata: aprire le 6 route dentro
Shopify Admin/Safari, attendere il completamento dei loader, poi eseguire
`npm run perf:loaders -- --since 10m`. Per analisi offline è possibile passare
log già raccolti con `--stdin`.
`npm run ui:shot-live` usa Playwright con profilo persistente
`.shopify-pw-profile/` per catturare screenshot dentro Shopify Admin. È pensato
per QA visuale autenticato e può richiedere login, captcha o 2FA al primo
avvio; gli output restano in `preview/shots/`.
`npm run jobs:status` usa `supabase db query --linked` e non richiede `DATABASE_URL` locale; usa `SUPABASE_DB_PASSWORD` o il Portachiavi macOS `syncbay-supabase-db-password` quando disponibile. Evita query concorrenti ripetute perché Supabase può bloccare temporaneamente nuove connessioni dopo troppi tentativi di autenticazione.
`npm run jobs:archive-stale-failures` usa lo stesso accesso Supabase in modalità
dry-run di default e, con `--apply`, marca come `CANCELLED` solo i vecchi
fallimenti `SYNC_INCREMENTAL` superati da un sync incrementale riuscito più
recente. Non riprova i job, non stampa payload prodotto, token o dati personali.
`npm run jobs:coalesce-shopify-changes` usa lo stesso accesso Supabase in
modalità dry-run di default e, con `--apply`, marca come `CANCELLED` solo i job
`DETECT_SHOPIFY_CHANGES` duplicati più vecchi quando esiste un job `PENDING` più
recente per lo stesso shop, topic Shopify e prodotto/inventory item. Non elimina
righe, non stampa payload prodotto e riduce lavoro ripetuto del runner quando
Shopify invia raffiche di webhook per gli stessi prodotti.
`npm run conflicts:doctor` usa Supabase CLI linked in sola lettura per
distinguere conflitti aperti, conflitti stale, falsi positivi description
riparabili e cooldown eBay che bloccano il retry; non stampa valori prodotto o
descrizioni.
`npm run ebay:rate-limits` legge i limiti eBay Trading reali via Analytics API
per applicazione e utente, usando token eBay cifrati dal database e
client-credentials per la quota applicativa; non stampa segreti e non modifica
eBay.
`npm run orders:paid-readiness` usa lo stesso accesso Supabase in sola lettura
per verificare sessione offline Shopify, scope `read_orders`/`write_orders`,
connessione eBay `EBAY_IT`, token eBay utilizzabili, coda stock/sync e mapping
candidati con snapshot `EUR` prima di una prova reale `orders/paid`; non stampa
token, segreti o dati cliente.
`npm run import:verify` usa Supabase CLI linked più l'endpoint runtime SyncBay `/api/diagnostics/shopify-admin`, protetto da `APP_SECRET`, per confrontare un campione dell'ultima run import tra snapshot eBay/SyncBay, mapping e prodotto Shopify live senza dipendere da `shopify store auth`. Lo script legge il secret da `SYNCBAY_INTERNAL_APP_SECRET`, `APP_SECRET` o dal Portachiavi macOS `syncbay-app-secret`; la vecchia strada Shopify CLI resta solo come fallback manuale esplicito con `--shopify-source cli`.
`npm run descriptions:cleanup-report` usa Supabase CLI linked e Trading API
`GetItem` in sola lettura per misurare, su un campione di listing reali, quanto
la pulizia descrizioni rimuove template, colori e markup non essenziale. Stampa
metriche e brevi estratti testuali; non scrive su eBay né su Shopify e aggiorna
solo il token eBay cifrato se scaduto.
`npm run descriptions:backfill-cleanup` usa Supabase CLI linked, Trading API
`GetItem` o, in via sperimentale, `GetSellerList` con
`--ebay-source seller-list`, e sessione offline Shopify per pianificare
l'applicazione retroattiva delle descrizioni pulite ai prodotti già importati.
È dry-run di default, non stampa HTML completo delle descrizioni, salta prodotti
con conflitti aperti o senza mapping Shopify, non modifica eBay e richiede
`--apply --confirm-apply` per scrivere `descriptionHtml` su Shopify e registrare
snapshot `SYNCBAY`. Per backfill lunghi usa prima
`--write-apply-plan /tmp/syncbay-description-apply-plan.json`: il file locale
contiene l'HTML pulito completo e non va committato. Il piano può essere ripreso
con `--apply-plan /tmp/syncbay-description-apply-plan.json --apply
--confirm-apply`, che rilegge solo Shopify per bloccare modifiche manuali
successive e non consuma quota eBay.
`npm run import:repair-commercial-fields` usa gli stessi snapshot per riallineare prezzo e SKU variante Shopify quando serve riparare prodotti creati prima del fix dedicato; usa sempre `--dry-run` prima della mutation reale.
`npm run stock:restore-ebay` è una scrittura reale su eBay: richiede `--confirm-real-ebay-write`, blocca l'esecuzione se ci sono job stock/sync attivi, verifica con Trading API `GetItem` e registra uno snapshot `SYNCBAY` di ripristino.
`npm run ebay:store-category-orphans` è in sola lettura: per ogni mapping ACTIVE chiama Trading API `GetItem` e segnala i listing attivi senza categoria del negozio (quelli non visibili nella vetrina pubblica eBay, normalizzando i placeholder `0`/`-999`). Non scrive su eBay né sui dati prodotto e aggiorna solo il token eBay cifrato se scaduto; usa `--limit N` per una lista parziale rapida.
`npm run categories:backfill` è un dry-run di default: per i mapping ACTIVE
confronta la categoria Shopify attuale con la proposta SyncBay derivata da
snapshot eBay, metafield prodotto `syncbay.*` o, solo quando mancano entrambi,
Trading API `GetItem`. Il report mostra il conteggio delle sorgenti usate
(`snapshot`, `metafield Shopify`, `eBay live`, `assenti`) per capire se sta
consumando quota eBay. Classifica righe applicabili, già corrette, conflitti
manuali e incerte; senza flag di apply non scrive prodotti Shopify e non
modifica eBay, salvo refresh della sessione offline Shopify e del token eBay
cifrato se scaduti. Quando un lookup Trading fallisce, il report include il
motivo tecnico nella riga JSON e nel campione umano. La scrittura reale richiede
`--apply --confirm-apply`, usa Shopify Admin GraphQL `productUpdate` e aggiorna
solo righe `applicable`, saltando categorie manuali diverse, righe incerte,
lookup falliti senza proposta locale valida e prodotti senza GID Shopify. I
conflitti categoria generati dal vecchio mapper possono essere inclusi solo con
`--repair-category-conflicts` e, in apply, anche
`--confirm-repair-category-conflicts`: il repair resta limitato a pattern
legacy riconosciuti e non forza conflitti manuali generici. La sovrascrittura
di tutti i conflitti categoria manuali richiede una decisione esplicita del
maintainer e i flag `--force-category-conflicts` e, in apply, anche
`--confirm-force-category-conflicts`.
`npm run facets:backfill` resta uno strumento diagnostico o di emergenza. Il
flusso ordinario di compilazione faccette passa dal runner `SYNC_INCREMENTAL`
e dai job automatici `facetOnly`.
Le definizioni Shopify dei metafield faccette restano da versionare appena la
toolchain consente di dichiarare il namespace esistente `syncbay_facets` senza
migrazione. Il runner può comunque scrivere i metafield prodotto già usati da
SyncBay; questa nota riguarda governance e Search & Discovery, non il backfill
automatico dei valori.
`npm run collections:doctor` è un doctor operativo dry-run di default: legge
prodotti e collezioni Shopify via Admin GraphQL/Shopify CLI (modello 2026-07
`collection sources / conditions`), segnala prodotti disponibili solo in
collezioni generiche, prodotti esauriti dentro collezioni specifiche e proposte
conservative di regole automatiche. Non crea collezioni, non cambia
handle/SEO/immagini/descrizioni e non scrive su Shopify senza `--intent-file`,
`--apply` e `--confirm-apply`. Gli intenti supportano un solo selettore per
collezione: `productTypeContains` (regola `TYPE`) oppure `titleContains` (regola
titolo OR con guardia inventario, condizione `ProductTitle` `matchType: ANY`
sotto inclusione `ALL`).
`npm run catalog:images:doctor` è in sola lettura sui listing eBay: misura la
copertura immagini degli snapshot Catalogo e chiama Trading API `GetItem` solo
per le prime righe senza immagine, così distingue listing davvero senza immagini
da prodotti candidati a backfill media. Non stampa URL, titoli o segreti e
aggiorna solo il token eBay cifrato se scaduto. La riparazione stabile vive nel
runner: quando il delta eBay è vuoto, SyncBay pianifica job `SYNC_INCREMENTAL`
con source `catalog_image_repair` per mapping attivi senza thumbnail, limitati
da `SYNCBAY_CATALOG_IMAGE_REPAIR_LIMIT`.
`npm run test:services` usa `tsx 4.23.0` esclusivamente come runner TypeScript
dei test `app/services/*.server.test.ts`; `pretest:services` rigenera prima il
client Prisma. `npm run test:runtime` esegue in sequenza test puri e test server
ed è il gate usato dalla CI. `npm run coverage:lib` continua a usare il test
runner nativo di Node e limita la coverage ai moduli puri `app/lib` già
isolabili dal runtime live; la soglia SyncBay corrente è `>=75%` linee e
`>=65%` branch su quel perimetro.
