# AGENTS.md

## Scopo

Questo file definisce le linee guida operative per agenti, Codex e collaboratori che lavorano su SyncBay.

Obiettivo: mantenere modifiche coerenti, sicure, documentate e facilmente revisionabili, senza introdurre lavoro collaterale non richiesto.

## Priorità delle istruzioni

1. Istruzioni di sistema/developer ricevute nella sessione corrente.
2. Questo file `AGENTS.md`.
3. Documentazione di progetto in `docs/` e `README.md`.
4. Assunzioni dell'agente.

In caso di conflitto, seguire sempre il livello più alto. Se una decisione nuova arriva dalla chat del maintainer e cambia il perimetro in modo stabile, aggiorna i documenti rilevanti.

## Cos'è SyncBay

SyncBay è una Shopify app per collegare un account eBay.it a Shopify e mantenere Shopify allineato al catalogo eBay.

La direzione confermata:

- sync principale eBay -> Shopify;
- eBay resta la sorgente di verità del catalogo;
- eccezione obbligatoria: gli ordini Shopify devono aggiornare la disponibilità su eBay per ridurre il rischio di vendere prodotti non disponibili;
- marketplace iniziale: eBay.it;
- prima custom app per pilota controllato, poi app pubblica Shopify App Store;
- sync target entro massimo 5 minuti;
- scala MVP fino a 2.000 prodotti per shop;
- prodotti non più attivi su eBay archiviati su Shopify, non cancellati;
- modifiche manuali Shopify gestite come conflitti visibili, non sovrascritte silenziosamente;
- prodotto self-service: diagnostica, retry e azioni guidate devono ridurre la dipendenza da supporto umano.

### Perimetro e non-obiettivi

SyncBay deve restare, nel MVP, una soluzione con richiamo sottile a eBay.it come punto di partenza: catalogo esistente, vetrina Shopify ordinata, disponibilità sincronizzate.

Una nuova funzionalità ha senso quando rafforza almeno uno di questi assi:

- import guidato e sicuro dei listing eBay in Shopify;
- sincronizzazione catalogo, prezzi, immagini, descrizioni e stock;
- protezione delle disponibilità e riduzione del rischio di vendere prodotti non disponibili;
- pulizia delle descrizioni/template eBay per renderle adatte a Shopify;
- gestione esplicita dei conflitti Shopify;
- diagnostica self-service, audit log, retry e rollback;
- affidabilità, sicurezza, privacy e manutenzione dell'app.

Per il MVP, SyncBay non è:

- una suite marketplace bidirezionale completa;
- un exporter Shopify -> eBay;
- un sistema avanzato di ordini, spedizioni, tracking o fulfillment;
- una soluzione multi-marketplace globale;
- un support desk gestito da operatori umani;
- un motore AI generalista di descrizioni o catalog enrichment;
- un gestionale ecommerce completo.

Spostamenti strutturali verso questi perimetri richiedono una decisione esplicita e, se permanenti, un ADR.

## Fonti primarie del progetto

Prima di modifiche non banali leggi:

1. `docs/syncbay-product-technical-plan.md`
2. `docs/context.md`
3. `BRAND.md`
4. `ROADMAP.md`
5. `docs/decisions-pending.md`
6. `docs/market/shopify-ebay-app-benchmark.md`
7. `docs/decisions/0001-stack.md`
8. `docs/decisions/0005-runtime-infrastructure.md`
9. `docs/decisions/0006-versioning-runtime-locale.md`
10. `README.md`

Per modifiche a stack, deploy, API Shopify/eBay, privacy, billing, pubblicazione App Store o modello dati, aggiorna o crea un ADR in `docs/decisions/`.

## Stato attuale del repository

Il repository ha completato la fase di pianificazione/fondazioni e contiene lo scaffold Shopify CLI React Router iniziale.

Regola importante: non creare worker dedicati, sync catalogo, job queue runtime, integrazioni eBay oltre OAuth o cartelle applicative ulteriori fuori dallo scaffold senza richiesta esplicita del maintainer.

La struttura documentale attuale è descritta in `docs/structure.md`.

## Stack deciso

La decisione stack corrente è documentata in `docs/decisions/0001-stack.md`.

Direzione attuale:

- Shopify CLI;
- template ufficiale React Router al momento dello scaffold;
- TypeScript/Node;
- Shopify Admin GraphQL;
- Supabase Postgres;
- Prisma;
- Supabase Queues;
- Supabase Cron;
- Vercel;
- Supabase Storage per staging immagini temporaneo quando serve.

Non introdurre un secondo runtime o framework senza aggiornare l'ADR e avere conferma del maintainer.

## Prima di intervenire

- Controlla sempre `git status --short`.
- Se il worktree contiene modifiche non tue o non collegate alla richiesta, non sovrascriverle e non normalizzarle. Ignorale se sono estranee, oppure lavora attorno a esse.
- Prima di proporre architetture, refactor o integrazioni, leggi documenti, configurazione e stato repo pertinenti.
- Per informazioni variabili su Shopify, eBay, App Store, API, piani, policy, billing o compliance, verifica fonti ufficiali aggiornate o pagine Shopify App Store correnti.
- Se la richiesta è ambigua su scope, comportamento atteso, rischio, deploy o pubblicazione, fai domande mirate prima di procedere.
- Procedi con un'assunzione dichiarata solo per dettagli marginali che non cambiano il risultato sostanziale.

## Disciplina di scope

- Mantieni le modifiche focalizzate sulla richiesta.
- Evita refactor, rinominazioni massive o riformattazioni non collegate.
- Preferisci patch piccole e coerenti.
- Non aggiungere nuove dipendenze, servizi o strumenti senza motivazione esplicita e impatto chiaro.
- Non inventare funzionalità non decise: se qualcosa è interessante ma non MVP, mettilo in roadmap/piano come futuro da valutare.

## Errori comuni da evitare

- Non promettere "real-time assoluto" indiscriminato: il target confermato e sync entro 5 minuti.
- Dove il real-time o quasi real-time è tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilità, preferiscilo e documenta il fallback.
- Non trasformare SyncBay in una app marketplace bidirezionale generica.
- Non assumere che Shopify sia la sorgente di verità: per il catalogo MVP la sorgente è eBay.
- Non aggiornare eBay con modifiche Shopify, salvo aggiornamenti di disponibilità derivati da ordini Shopify.
- Non cancellare prodotti Shopify quando un listing eBay sparisce: archiviali.
- Non sovrascrivere modifiche manuali Shopify senza aprire conflitto.
- Non dipendere dal supporto umano per errori ordinari: gli errori devono essere comprensibili e azionabili in dashboard.
- Non dedurre dati eBay non restituiti dalle API. Se un campo non arriva, dichiaralo come assente o non supportato.
- Non usare dati reali di negoziante, ordini, clienti o listing in fixture, screenshot, log o documentazione.
- Quando scrivi UI, microcopy o materiali prodotto, considera che target e lingua sono italiani: evita inglesismi non necessari come "merchant", "seller" o "overselling" se puoi usare "negoziante", "venditore" o "vendere prodotti non disponibili".
- I file `.DS_Store` non fanno parte del repository: ignorali sempre e rimuovili se vengono tracciati per errore.

## Shopify ed eBay

### Shopify

- Usa Shopify Admin GraphQL come interfaccia primaria per prodotti, inventario, media e webhook.
- Mantieni compatibilità con Shopify CLI e app embedded.
- Prima di fissare scope o webhook, verifica la documentazione Shopify aggiornata.
- Tratta location, inventory item, product status, media e webhook come superfici critiche: impattano direttamente disponibilità e vetrina Shopify.
- Per modifiche future alla UI embedded, usa pattern coerenti con Shopify Admin e Polaris/App Bridge quando saranno introdotti.

### eBay

- Per leggere tutti i listing attivi, prevedi Trading API dove serve, per coprire listing storici creati da Seller Hub/UI eBay.
- Usa Inventory API dove disponibile, soprattutto per casi compatibili con inventory/offer e aggiornamenti stock.
- Verifica sempre la documentazione eBay corrente per notifiche, OAuth, rate limit, marketplace account deletion e requisiti compliance.
- Non assumere che Inventory API copra tutte le inserzioni di un negoziante.

## Lingua, tono e prodotto

- Usa italiano come lingua predefinita con il maintainer.
- La UI negoziante di SyncBay deve essere in italiano nella fase eBay.it-first, salvo integrazioni o termini tecnici Shopify/eBay che richiedano label originali.
- Tono UI: professionale, concreto, calmo. Frasi brevi, stato del sistema, azione successiva chiara. Vedi `BRAND.md`.
- Evita emoji nella UI, esclamativi multipli, "oops" o messaggi vaghi.
- Mantieni identificatori nel codice in inglese quando coerente con librerie e framework.
- Non usare colori, loghi o claim che facciano sembrare SyncBay un'app ufficiale eBay o Shopify senza approvazione esplicita.
- Il richiamo a eBay e Shopify deve esserci, ma restare sottile nel branding: chiaro nel contesto funzionale, non urlato in tagline, palette o logo.

## Sicurezza, privacy e dati

- Non committare segreti, token, credenziali, file `.env` reali o dati personali.
- Token Shopify/eBay devono essere cifrati a riposo.
- Non stampare segreti in log, errori o risposte chat. Per verificarne la presenza usa controlli booleani, mai `echo $VAR`.
- Tratta dati shop, inserzioni, ordini, clienti e immagini come dati del negoziante.
- Evita leak in log, fixture, screenshot, test o report.
- Per webhook pubblici e callback OAuth, valida sempre firma/HMAC/stato/nonce secondo il provider.
- Shopify GDPR webhook, disinstallazione app, revoca token e eBay marketplace account deletion devono restare requisiti di primo piano.

## Documentazione

SyncBay è attualmente guidata dalla documentazione. Aggiornala quando cambia una decisione stabile.

### Cosa aggiornare e quando

- `docs/syncbay-product-technical-plan.md`: perimetro prodotto, MVP, fasi, requisiti funzionali e rischi.
- `docs/market/shopify-ebay-app-benchmark.md`: benchmark competitivo e differenziazione.
- `ROADMAP.md`: priorità, backlog e stato decisioni/prossime fasi.
- `CHANGELOG.md`: storico modifiche significative.
- `BRAND.md`: identità, tagline, tono, palette direzionale, logo direction e claim vietati.
- `docs/context.md`: handoff rapido per nuove chat o nuovi agenti.
- `docs/decisions-pending.md`: decisioni aperte e blocchi prima delle prossime fasi.
- `docs/data-model.md`: entità e regole dati concettuali.
- `docs/glossario.md`: terminologia prodotto e microcopy.
- `docs/guides/`: guide operative tematiche.
- `docs/guides/pre-scaffold-checklist.md`: prerequisiti e stato scaffold.
- `docs/guides/provisioning-runtime.md`: provisioning Vercel/Supabase e riferimenti non segreti.
- `docs/guides/service-governance.md`: limiti MVP, retention, error handling e governance servizio.
- `docs/guides/git-e-pubblicazione.md`: policy Git/branch/PR/pubblicazione.
- `docs/decisions/`: decisioni architetturali o operative stabili.
- `docs/decisions/0005-runtime-infrastructure.md`: infrastruttura runtime MVP Vercel + Supabase.
- `docs/decisions/0006-versioning-runtime-locale.md`: versioning SemVer locale.
- `docs/structure.md`: struttura repo prevista nella fase corrente.
- `README.md`: stato progetto, documenti principali e prossimo passo operativo.
- `SECURITY.md`: policy sicurezza root.
- `.env.example`: solo quando vengono decise nuove env var o scope necessari.
- `AGENTS.md`: regole operative per agenti e Codex.

Non creare documenti duplicati. Se serve dettaglio nuovo, preferisci integrare il piano principale o creare un ADR mirato.

Per modifiche solo documentali, non inventare test applicativi: rileggi i documenti toccati, verifica link interni e coerenza con il piano.

## Testing e verifica

Per modifiche docs-only:

- per docs-only, usa almeno review del documento e, quando utile, `git diff --check`;
- non dichiarare test applicativi non eseguiti;
- se un controllo non è pertinente, dichiararlo come limite normale della fase corrente.

Per modifiche runtime:

- mantieni questo file aggiornato con i comandi reali del repo;
- aggiungi gate per lint, test, build, typecheck, audit e verifiche browser quando pertinenti;
- mantieni i comandi allineati allo stack effettivamente generato.

Comandi runtime attuali:

- `npm install`
- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm audit --omit=dev`
- `npm run release:dry-run`

## Git, commit e PR

- Usa commit atomici e messaggi Conventional Commit coerenti con l'impatto reale:
  - `docs:` per sola documentazione;
  - `feat:` per nuove funzionalità osservabili;
  - `fix:` per correzioni osservabili;
  - `perf:` per miglioramenti prestazionali osservabili;
  - `chore:` per manutenzione interna;
  - `refactor:` solo per ristrutturazioni senza cambio funzionale;
  - `test:` per soli test;
  - `ci:` per workflow/CI.
- Prima di commit o PR, fai self-review del diff.
- GitHub è la fonte primaria del codice e della documentazione pubblicata: remote canonico `https://github.com/max23468/SyncBay`.
- Non aggiungere workflow GitHub Actions, policy deploy o release flow senza richiesta esplicita e senza ADR.
- Per lavori non banali usa branch dedicati `codex/<tema>`, PR verso `main`, self-review, verifiche rilevanti e merge quando la PR è pronta.
- Per modifiche minuscole e chiaramente docs-only puoi lavorare su `main` aggiornato, committare e pushare direttamente, purché il diff resti limitato e non tocchi runtime, workflow, deploy, release, segreti o decisioni ambigue.
- Per docs-only sono sufficienti review contenuto e `git diff --check`, salvo documenti operativi critici.
- Quando una PR viene mergeata, fai cleanup del branch remoto e locale se non serve più. Prima prova `git branch -d <branch>`; usa `git branch -D` solo dopo aver verificato che `git log --cherry-pick --right-only --oneline main...<branch>` non mostri commit unici.
- I commenti del bot Codex sulle PR sono raccolti nella issue GitHub `Codex feedback inbox`, aggiornata dal workflow `.github/workflows/codex-pr-comments.yml`.
- Prima di mergiare una PR non banale, controlla se la `Codex feedback inbox` segnala thread actionable collegati alla PR corrente.
- Se il maintainer chiede "pubblica", "manda su GitHub", "carica" o formule simili, interpreta la richiesta come pubblicazione su GitHub: verifiche rilevanti, commit coerente, push e, per lavori non banali, PR/merge su `main`.
- "Pubblica" non significa automaticamente deploy, release versionata, billing, App Store o integrazioni produttive.
- Se il maintainer chiede "deploya" o "pubblica e deploy", verifica prima se esiste una policy SyncBay attuale. Oggi non esiste deploy production: dichiaralo e procedi solo dopo decisione esplicita.
- Se il maintainer chiede "rilascia", usa il versioning locale documentato in `docs/guides/versioning-e-release.md`, salvo richiesta esplicita di tag, GitHub Release o deploy.
- In caso di dubbio tra commit, PR, deploy, release o pubblicazione App Store, fermati e chiedi conferma prima di azioni esterne o irreversibili.

Dettagli: `docs/guides/git-e-pubblicazione.md`.

## Release, deploy e App Store

SyncBay ha un flusso di versioning locale, ma non ha ancora un flusso di deploy production.

Fino a decisione esplicita:

- non configurare deploy;
- non creare tag GitHub o GitHub Release;
- non introdurre billing;
- non avviare pubblicazione Shopify App Store;
- non creare integrazioni produttive Shopify/eBay.

Versioning locale:

- `app/lib/version.ts` è la single source of truth per `APP_VERSION` e `BUILD_DATE`;
- `npm run release` prepara una release aggiornando `CHANGELOG.md` e `app/lib/version.ts`;
- `npm run release:dry-run` verifica la categoria senza modificare file;
- il comando non crea deploy, tag o GitHub Release.

Ogni modifica deve essere classificata prima della chiusura:

- `MAJOR`: breaking change visibile a negoziante, operatori o contratti API/config;
- `MINOR`: nuova funzionalità retrocompatibile;
- `PATCH`: bugfix, hardening o miglioramento operativo compatibile;
- `Non versionato`: piani, ADR, guide interne, regole agenti e documentazione non esposta al prodotto.

Prima di dichiarare conclusa una fase o una pubblicazione, controlla sempre `CHANGELOG.md`: se contiene solo `Non versionato`, non serve release SemVer; se contiene cambi runtime futuri in sezioni versionate, non chiudere senza release oppure senza dichiarare il rilascio come prossimo step operativo.

Quando deploy production o pubblicazione App Store verranno decisi, aggiungi ADR e aggiorna `AGENTS.md`, `README.md`, `.env.example`, `docs/guides/git-e-pubblicazione.md`, `docs/guides/versioning-e-release.md` e il piano tecnico.

Dettagli: `docs/guides/versioning-e-release.md`, ADR `docs/decisions/0006-versioning-runtime-locale.md` e policy futura CI/deploy in `docs/decisions/0004-runtime-ci-release-future.md`.

## Risposte finali e handoff

Nelle risposte finali:

- riassumi cosa e cambiato o scoperto;
- indica i file principali toccati;
- riporta verifiche solo quando utili o quando ci sono limiti/rischi;
- dichiara rischi residui concreti;
- includi sempre i prossimi passi consigliati quando esiste un seguito operativo reale;
- i prossimi passi devono essere concreti, ordinati e proporzionati al lavoro appena concluso;
- se non c'è un prossimo passo utile, dichiaralo esplicitamente invece di forzare una lista generica.

Evita footer rituali sui test. Non inventare risultati.

## Definizione di completamento

Una modifica è pronta se:

- risolve la richiesta senza allargare inutilmente lo scope;
- resta coerente con perimetro e documenti di SyncBay;
- non introduce worker, sync o integrazioni produttive senza approvazione;
- non sovrascrive modifiche non tue;
- aggiorna documenti/ADR quando una decisione cambia davvero;
- non lascia segreti, dati personali, file temporanei o modifiche non correlate;
- include verifiche eseguite o limiti noti quando rilevanti.

## Sotto-moduli

Per regole specifiche di sotto-moduli, aggiungere `AGENTS.md` nelle relative sottocartelle.

Le istruzioni più profonde prevalgono sui livelli superiori.
