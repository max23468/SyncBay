# AGENTS.md

Regole operative per agenti e collaboratori su SyncBay. In conflitto vince, in
ordine: istruzioni di sessione, un `AGENTS.md` più profondo, questo file, gli ADR
in `docs/decisions/`, il codice vicino. La memoria `.mex/` è un indice locale: se
contraddice queste fonti è stale e va aggiornata, non seguita.

## Cos'è SyncBay

Shopify app privata eBay.it-first, versione 1.0. eBay è la sorgente di verità del
catalogo e Shopify ne è la copia ordinata: il flusso è eBay -> Shopify, e l'unica
scrittura Shopify -> eBay ammessa è la disponibilità derivata dagli ordini
Shopify. Il target di sync è configurabile tra 5 e 30 minuti, senza promesse di
real-time. Il limite operativo è 2.000 prodotti per shop.

## Invarianti

- Un listing eBay non più attivo resta su Shopify come esaurito: scorta `0`,
  policy `DENY`, tag `esaurito`, mapping `OUT_OF_STOCK`. Non va cancellato né
  archiviato, per preservarne la SEO (ADR 0011).
- Le modifiche manuali su Shopify aprono conflitti visibili e non vengono
  sovrascritte in silenzio.
- Non dedurre dati che Shopify o eBay non restituiscono: dichiarali assenti o non
  supportati.
- Errori ordinari, retry e diagnostica devono restare comprensibili e azionabili
  dal negoziante senza supporto umano.
- La 1.0 non è una suite marketplace bidirezionale, un exporter Shopify -> eBay,
  un gestionale ordini, una piattaforma multi-marketplace o un motore AI.
  Ampliare stabilmente il perimetro richiede conferma esplicita e ADR, come
  introdurre nuovi runtime, worker, code esterne, framework o provider.

## Sicurezza e dati

- Niente segreti, token, credenziali, `.env` reali o dati personali in commit,
  log od output: verifica le env con controlli booleani, mai stampandone i
  valori.
- I token Shopify ed eBay persistiti sono cifrati a riposo.
- Valida firma, HMAC, stato o nonce di webhook pubblici e callback OAuth secondo
  il provider. Restano prioritari i webhook GDPR Shopify, disinstallazione,
  revoca token ed eBay marketplace account deletion.
- Niente dati reali di negozianti, listing, ordini o clienti in fixture,
  screenshot, log, test o documentazione: le fixture sono sintetiche.
- Nel repository restano codice, schema, migration, fixture e docs. Non
  committare build, cache, sessioni browser, stato locale dei provider, export di
  lavoro, output della distribuzione privata o `.mex/telemetry-id`.

## Provider e UI

- Shopify: Admin GraphQL per prodotti, inventario, media e webhook, mantenendo
  compatibilità con Shopify CLI, App Bridge e app embedded. Location, inventory
  item, stato prodotto, media e webhook sono superfici critiche.
- eBay: Inventory API dove copre il caso, Trading API quando serve leggere
  listing storici o creati da Seller Hub. Inventory API non copre tutti i listing
  del negoziante. OAuth, notifiche, rate limit e compliance cambiano spesso:
  verificali su documentazione eBay corrente invece che a memoria.
- UI embedded sui Polaris Web Components (`s-*`); `@shopify/polaris` React legacy
  richiede conferma e ADR (ADR 0010). Prima di markup o CSS custom cerca la
  primitiva nativa: il CSS custom resta per identità SyncBay, shell/logo e
  composizioni non coperte, e va dichiarato nel riepilogo.
- Colori di stato secondo `BRAND.md` e ADR 0013, usati come accento e non come
  campitura. SyncBay non è un'app ufficiale eBay o Shopify.

## Lavorare nel repo

- Il checkout può contenere lavoro di altri, agenti inclusi: apri con
  `git status --short --branch -uall` e non spostare, normalizzare o cancellare
  modifiche che non sono tue.
- Se il task si sovrappone a quel lavoro, isola con `npm run worktree:create`
  (opzione `--branch codex/<tema>`), sempre dal checkout principale e mai da
  un'altra worktree. Se il setup si interrompe riprendi dentro la worktree con
  `npm run worktree:prepare`, senza ricrearla.
- Per lavori non banali parti da `docs/CONTEXT.md`, usa `docs/INDEX.md` (e
  `.mex/ROUTER.md`, se lo scaffold locale è presente) per trovare la fonte, e
  apri solo ciò che serve al task.
- Tieni il diff proporzionato alla richiesta: refactor, rinominazioni,
  riformattazioni o dipendenze collaterali non richiesti restano fuori.
- Aggiorna la documentazione solo quando cambia una decisione, un comportamento o
  una procedura stabile, nella fonte canonica corrispondente:

| Cambiamento                                        | Fonte canonica                             |
| -------------------------------------------------- | ------------------------------------------ |
| Perimetro prodotto o requisiti 1.0                 | `docs/syncbay-product-technical-plan.md`   |
| Stato e handoff rapido                             | `docs/CONTEXT.md`                          |
| Priorità future o debiti                           | `docs/ROADMAP.md` / `docs/BACKLOG.md`      |
| Decisione architetturale, dati, provider o release | `docs/decisions/`                          |
| Comandi e toolchain                                | `docs/TOOLCHAIN.md`                        |
| Procedura operativa                                | guida pertinente in `docs/guides/`         |
| Identità, tono o palette                           | `BRAND.md`                                 |
| Nuova env o scope                                  | `.env.example` e documentazione pertinente |

## Verifica

La corsia giusta e i comandi correnti stanno in `docs/TOOLCHAIN.md`, sezione
"Verifiche per tipo di modifica": segui quella tabella invece di ricostruire i
gate a mano. Vincoli che la tabella non dice:

- Non lanciare in parallelo nello stesso worktree comandi che scrivono
  `node_modules`, cache, build, typegen o Prisma Client.
- Le ricevute locali valgono finché diff, lockfile, Node e lista comandi hanno lo
  stesso fingerprint; usa `--force` quando serve una prova fresca. Provider,
  database, browser e deploy restano sempre verifiche fresche e dichiarate.
- Dopo merge, rebase o cambio di `package-lock.json` riallinea dipendenze e
  Prisma Client prima di classificare un errore come regressione.
- Riporta risultati reali: se un gate non è stato eseguito, dillo.

## Git e pubblicazione

Il flusso completo è in `docs/guides/git-e-pubblicazione.md` e
`docs/guides/versioning-e-release.md`. Cosa intende il maintainer:

- `pubblica`, `manda su GitHub` o `carica`: porta il diff fino a `main` con gate
  e cleanup e, quando tocca runtime o UI, include il deploy Vercel production
  verificato.
- `deploya`: aggiorna e verifica il deployment Vercel production privato anche
  per diff senza runtime; non implica App Store né billing.
- `rilascia`: flusso SemVer locale più pubblicazione su GitHub. Una release
  prodotto reale vuole tag `vX.Y.Z` e GitHub Release (ADR 0008); docs e
  governance non versionati no.

Ogni modifica passa da branch `codex/<tema>` e PR verso `main`, docs incluse: la
ruleset GitHub respinge i push diretti. Il titolo PR è Conventional Commit e
riflette l'impatto osservabile, non il nome del branch. Prima di PR ready, merge,
publish o release esegui il preflight remoto e leggi i review thread Codex della
PR corrente. Se `[Non rilasciato]` in `CHANGELOG.md` contiene sezioni versionate
serve `npm run release`.

## Autonomia e comunicazione

Decidi da solo i dettagli ordinari; chiedi quando letture diverse della richiesta
producono lavoro materialmente diverso, o prima di azioni esterne difficilmente
reversibili non ancora autorizzate: attivare negozi, account o integrazioni
produttive, avviare billing o pubblicazione sullo Shopify App Store.

Rispondi al maintainer e scrivi la UI negoziante in italiano, salvo termini
tecnici che richiedono la label originale. Tono UI: professionale, concreto e
calmo, frasi brevi, stato del sistema e prossima azione chiara, senza emoji.

Al maintainer parla conciso, con l'esito per primo: una frase su cosa stai per
fare prima del primo tool, poi aggiornamenti solo su scoperte importanti o cambi
di direzione. Chiudi con cosa è cambiato, file principali, verifiche eseguite e
loro risultato, stato Git/publish/deploy e prossimo passo se esiste. Documenti e
ADR scritti su disco seguono la stessa misura: sostanza, niente riempimento.
Delega a un subagent solo tracce grandi e davvero indipendenti, mai per
ricontrollare il tuo lavoro.
