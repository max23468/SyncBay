# AGENTS.md

## Scopo e priorità

Queste sono le regole operative per agenti, Codex e collaboratori che lavorano
su SyncBay. L'obiettivo è produrre modifiche focalizzate, sicure, verificabili e
facili da revisionare.

Ordine di priorità:

1. istruzioni di sistema o developer della sessione;
2. `AGENTS.md` più profondi, limitatamente alla cartella interessata;
3. questo file;
4. ADR e documentazione canonica in `docs/`;
5. codice, test e configurazioni vicine;
6. assunzioni, solo per dettagli marginali.

Se una decisione del maintainer cambia stabilmente prodotto, architettura,
provider, dati, deploy o release, aggiorna la fonte canonica o crea un ADR.

## Invarianti di SyncBay

SyncBay è una Shopify app eBay.it-first. Nella custom app privata 1.0:

- eBay è la sorgente di verità del catalogo e Shopify ne è la copia ordinata;
- il flusso principale è eBay -> Shopify;
- l'unica scrittura Shopify -> eBay ammessa è l'aggiornamento della
  disponibilità derivato dagli ordini Shopify;
- il target di sync è configurabile tra 5 e 30 minuti, senza promesse di
  real-time assoluto;
- il limite operativo è 2.000 prodotti per shop;
- un listing eBay non più attivo resta su Shopify come esaurito: scorta `0`,
  policy `DENY`, tag `esaurito`, mapping `OUT_OF_STOCK`; non va cancellato o
  archiviato, per preservarne la SEO (ADR 0011);
- le modifiche manuali Shopify generano conflitti visibili e non vengono
  sovrascritte silenziosamente;
- errori ordinari, retry e diagnostica devono essere comprensibili e azionabili
  senza dipendere dal supporto umano.

Non trasformare la 1.0 in una suite marketplace bidirezionale, un exporter
Shopify -> eBay, un gestionale ordini/fulfillment, una piattaforma
multi-marketplace o un motore AI generalista. Un ampliamento stabile di questo
perimetro richiede conferma esplicita e ADR.

## Prima di lavorare

1. Esegui `git status --short --branch -uall`.
2. Tratta modifiche staged, unstaged e untracked come lavoro dell'utente: non
   spostarle, normalizzarle, sovrascriverle, nasconderle o cancellarle.
3. Se il checkout sporco si sovrappone al task, usa un branch/worktree dedicato
   da una base pulita oppure chiedi conferma; per file non sovrapposti puoi
   lavorare nello stesso checkout dichiarandolo nel riepilogo.
4. Per creare una worktree SyncBay usa dal checkout principale
   `npm run worktree:create -- --branch codex/<tema>`: il comando verifica
   isolamento, base, ignore e collisioni, poi installa dipendenze, genera
   Prisma e lancia la baseline in serie. Se il setup viene interrotto, entra
   nella worktree e usa `npm run worktree:prepare`; non ricrearla alla cieca.
5. Per lavori non banali leggi `docs/CONTEXT.md`. Usa `docs/INDEX.md` solo per
   trovare una fonte e, se serve memoria routata, `.mex/ROUTER.md`; apri poi
   soltanto documenti, contesti e pattern pertinenti al task.
6. Per architettura, refactor o integrazioni verifica anche ADR, configurazione
   e codice interessati. Per informazioni variabili su provider, API, policy,
   piani, billing o compliance usa fonti ufficiali aggiornate.
7. Se scope, comportamento atteso, rischio, deploy o release sono ambigui in
   modo sostanziale, fai una domanda mirata prima di procedere.

La memoria `.mex/` è un indice locale, non una fonte superiore. Se contraddice
questo file, un ADR o `docs/`, considerala stale e aggiornala chirurgicamente.
Non committare `.mex/telemetry-id`, segreti, output locali o dati reali.

## Regole di modifica

- Mantieni il diff proporzionato alla richiesta: niente refactor, rinominazioni,
  riformattazioni, dipendenze o strumenti collaterali senza necessità chiara.
- Non introdurre nuovi runtime, worker dedicati, code esterne, framework,
  provider o cartelle applicative fuori dallo scaffold senza conferma del
  maintainer e, se la scelta è stabile, ADR.
- Non dedurre dati che Shopify o eBay non restituiscono: dichiarali assenti o
  non supportati.
- Non usare dati reali di negozianti, listing, ordini o clienti in fixture,
  screenshot, log, test o documentazione.
- Non committare `.DS_Store`, build, cache, sessioni browser, stato locale dei
  provider, staging, export di lavoro o output della distribuzione privata.
  Nel repository restano codice, schema, migration, fixture sintetiche e docs.
- Usa le skill o gli strumenti disponibili quando aiutano davvero il task;
  scegli tra plugin, connector, MCP, app, CLI, API e browser in base a copertura,
  affidabilità, autenticazione e qualità delle prove. Non aggirare permessi,
  policy, rate limit, quote o blocchi economici.

## Shopify, eBay e UI

### Shopify

- Usa Shopify Admin GraphQL per prodotti, inventario, media e webhook.
- Mantieni compatibilità con Shopify CLI, App Bridge e app embedded.
- Per la UI embedded usa Polaris Web Components Shopify (`s-*`) come base.
  Prima di markup o CSS custom verifica se esiste una primitiva nativa adatta.
- Non introdurre `@shopify/polaris` React legacy senza conferma e ADR.
- Limita il CSS custom a identità SyncBay, shell/logo, disclosure tecniche o
  composizioni non coperte dai componenti Shopify. Dichiaralo nel riepilogo;
  se diventa strutturale, aggiorna la documentazione.
- Tratta location, inventory item, stato prodotto, media e webhook come
  superfici critiche.

### eBay

- Usa Inventory API dove copre il caso; usa Trading API quando serve leggere
  listing storici o creati da Seller Hub/UI.
- Non assumere che Inventory API copra tutti i listing del negoziante.
- Verifica la documentazione eBay corrente per OAuth, notifiche, rate limit,
  marketplace account deletion e compliance.

### Lingua e identità

- Rispondi al maintainer e scrivi la UI negoziante in italiano, salvo termini
  tecnici che richiedono la label originale.
- Tono UI: professionale, concreto e calmo; frasi brevi, stato del sistema e
  prossima azione chiara. Evita emoji, vaghezza e inglesismi non necessari.
- Non presentare SyncBay come app ufficiale eBay o Shopify.
- Segui `BRAND.md` e ADR 0013: verde Shopify per successo, blu eBay per
  informazione/primario, giallo eBay per avviso, rosso eBay per errore. Usa i
  colori come accenti, icone, badge e bordi, non come campiture diffuse.

## Sicurezza e dati

- Non committare o stampare segreti, token, credenziali, `.env` reali o dati
  personali. Verifica la presenza delle env con controlli booleani, mai
  mostrando i valori.
- I token Shopify ed eBay persistiti devono essere cifrati a riposo.
- Valida firma, HMAC, stato o nonce di webhook pubblici e callback OAuth secondo
  il provider.
- Mantieni prioritari webhook GDPR Shopify, disinstallazione, revoca token ed
  eBay marketplace account deletion.

## Documentazione

Aggiorna la documentazione solo quando cambia una decisione, un comportamento o
una procedura stabile. Non creare documenti duplicati.

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

Durante migrazioni o rinomini preserva contenuti validi, aggiorna link e indici
e dichiara cosa rimuovi perché superato.

## Verifica proporzionata al rischio

Usa la matrice e i comandi correnti in `docs/TOOLCHAIN.md`:

- **Analisi senza modifiche:** cita fonti e limiti; nessun test applicativo.
- **Veloce:** docs/governance a basso rischio; rilettura, coerenza, link
  pertinenti e `git diff --check`.
- **Standard:** codice o configurazione ordinari; test mirati, typecheck, lint e
  build quando pertinenti.
- **Completa:** runtime condiviso, UI sostanziale, Prisma/database, provider,
  auth, sicurezza, dati, deploy o release; gate completi, smoke e verifiche live
  applicabili.

Non dichiarare test o verifiche non eseguiti. Prima di commit o PR fai
self-review dell'intero diff pertinente.

### Stop condition e riuso delle verifiche

- Non eseguire in parallelo nello stesso worktree comandi che scrivono
  `node_modules`, cache, build, typegen o Prisma Client. I gate repo vanno
  eseguiti in serie.
- Se lo stesso comando fallisce due volte con lo stesso errore, fermati e cambia
  ipotesi diagnostica. Un terzo tentativo identico richiede nuova evidenza o una
  modifica concreta allo stato.
- Dopo merge, rebase o cambio di `package-lock.json`, riallinea checkout,
  dipendenze e Prisma Client prima di classificare un errore come regressione.
- Non creare una worktree da un'altra worktree e non ripetere `git worktree
add` dopo un setup incompleto: usa il preflight del comando canonico e
  riprendi con `npm run worktree:prepare`.
- `npm run verify:changed` sceglie ed esegue la corsia minima sicura;
  `npm run verify:full` esegue i gate runtime completi una sola volta. Le
  ricevute locali sono riusabili solo finché diff, lockfile, Node e lista dei
  comandi mantengono lo stesso fingerprint; usa `--force` quando serve una
  prova fresca.
- Non riusare ricevute per provider, database, browser, deploy o altri controlli
  live: questi restano verifiche fresche e dichiarate.

## Git, pubblicazione e release

Segui `docs/guides/git-e-pubblicazione.md` e
`docs/guides/versioning-e-release.md`. In sintesi:

- usa Conventional Commit; il tipo riflette l'impatto osservabile;
- ogni modifica passa da branch `codex/<tema>` e PR verso `main` con
  verifiche, self-review e cleanup: la ruleset GitHub respinge i push diretti
  su `main`, anche docs-only;
- il titolo PR deve essere Conventional Commit, non il nome del branch;
- `pubblica`, `manda su GitHub` o `carica` significa portare il diff fino a
  GitHub/`main`, completando i gate e il cleanup previsti; per modifiche che
  toccano runtime o UI include anche il deploy Vercel production verificato
  (vedi `docs/guides/git-e-pubblicazione.md`, "Cosa significa pubblicare");
- `deploya` include il deployment Vercel production privato e la sua verifica
  anche per diff senza runtime/UI; non implica App Store o billing;
- `rilascia` include il flusso SemVer locale e la pubblicazione su GitHub;
- prima di pubblicare controlla `[Non rilasciato]` in `CHANGELOG.md`: sezioni
  versionate richiedono `npm run release`; solo `Non versionato` non richiede
  bump;
- per una release prodotto reale servono tag `vX.Y.Z` e GitHub Release secondo
  ADR 0008; docs e governance non versionati non richiedono tag;
- prima di PR ready, merge, publish, deploy o release esegui il preflight remoto
  e controlla i review thread Codex della PR corrente. La `Codex feedback
inbox` è fallback e controllo post-merge; i thread di altre PR non entrano
  nel preflight del filone corrente;
- non avviare billing o pubblicazione Shopify App Store senza decisione
  esplicita. Non attivare nuovi negozi, account o integrazioni provider
  produttive senza conferma.

Se resta un dubbio sostanziale tra commit, PR, deploy, release o App Store,
chiedi conferma prima dell'azione esterna o irreversibile.

## Definizione di completamento

Il lavoro è pronto quando:

- risolve la richiesta senza scope collaterale;
- rispetta invarianti, ADR e documentazione canonica;
- preserva modifiche altrui e non lascia segreti, dati reali o output locali;
- aggiorna docs o ADR solo dove necessario;
- include verifiche proporzionate e risultati reali;
- publish, release, deploy, branch e worktree sono completati o dichiarati non
  applicabili con motivo.

Nella risposta finale riassumi: cosa è cambiato o emerso, file principali,
verifiche utili, stato Git/publish/release/deploy, rischi residui e prossimo
passo concreto. Se non esiste un seguito utile, dichiaralo senza aggiungere una
lista rituale.
