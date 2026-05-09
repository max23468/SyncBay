# AGENTS.md

## Scopo

Questo file definisce le linee guida operative per agenti, Codex e collaboratori che lavorano su SyncBay.

Obiettivo: mantenere modifiche coerenti, sicure, documentate e facilmente revisionabili, senza introdurre lavoro collaterale non richiesto.

## Priorita delle istruzioni

1. Istruzioni di sistema/developer ricevute nella sessione corrente.
2. Questo file `AGENTS.md`.
3. Documentazione di progetto in `docs/` e `README.md`.
4. Assunzioni dell'agente.

In caso di conflitto, seguire sempre il livello piu alto. Se una decisione nuova arriva dalla chat del maintainer e cambia il perimetro in modo stabile, aggiorna i documenti rilevanti.

## Cos'e SyncBay

SyncBay e una Shopify app per collegare un account eBay.it a Shopify e mantenere Shopify allineato al catalogo eBay.

La direzione confermata:

- sync principale eBay -> Shopify;
- eBay resta la sorgente di verita del catalogo;
- eccezione obbligatoria: gli ordini Shopify devono aggiornare la disponibilita su eBay per evitare overselling;
- marketplace iniziale: eBay.it;
- prima custom app per pilota controllato, poi app pubblica Shopify App Store;
- sync target entro massimo 5 minuti;
- scala MVP fino a 2.000 prodotti per shop;
- prodotti non piu attivi su eBay archiviati su Shopify, non cancellati;
- modifiche manuali Shopify gestite come conflitti visibili, non sovrascritte silenziosamente;
- prodotto self-service: diagnostica, retry e azioni guidate devono ridurre la dipendenza da supporto umano.

### Perimetro e non-obiettivi

SyncBay deve restare, nel MVP, una soluzione eBay-first per trasformare un catalogo eBay.it in uno shop Shopify pulito, sincronizzato e protetto dall'overselling.

Una nuova funzionalita ha senso quando rafforza almeno uno di questi assi:

- import guidato e sicuro dei listing eBay in Shopify;
- sincronizzazione catalogo, prezzi, immagini, descrizioni e stock;
- prevenzione overselling;
- pulizia delle descrizioni/template eBay per renderle adatte a Shopify;
- gestione esplicita dei conflitti Shopify;
- diagnostica self-service, audit log, retry e rollback;
- affidabilita, sicurezza, privacy e manutenzione dell'app.

Per il MVP, SyncBay non e:

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
3. `ROADMAP.md`
4. `docs/decisions-pending.md`
5. `docs/market/shopify-ebay-app-benchmark.md`
6. `docs/decisions/0001-stack.md`
7. `README.md`

Per modifiche a stack, deploy, API Shopify/eBay, privacy, billing, pubblicazione App Store o modello dati, aggiorna o crea un ADR in `docs/decisions/`.

## Stato attuale del repository

Il repository e in fase di pianificazione e fondazioni.

Regola importante: non creare scaffold applicativo, `package.json`, app Shopify CLI, cartelle runtime (`app/`, `src/`, `prisma/`, `workers/`) o codice applicativo senza richiesta esplicita del maintainer.

La struttura documentale attuale e descritta in `docs/structure.md`.

## Stack deciso

La decisione stack corrente e documentata in `docs/decisions/0001-stack.md`.

Direzione attuale:

- Shopify CLI;
- template ufficiale React Router al momento dello scaffold;
- TypeScript/Node;
- Shopify Admin GraphQL;
- PostgreSQL;
- job queue persistente;
- deployment da decidere dopo la scelta infrastrutturale.

Non introdurre un secondo runtime o framework senza aggiornare l'ADR e avere conferma del maintainer.

## Prima di intervenire

- Controlla sempre `git status --short`.
- Se il worktree contiene modifiche non tue o non collegate alla richiesta, non sovrascriverle e non normalizzarle. Ignorale se sono estranee, oppure lavora attorno a esse.
- Prima di proporre architetture, refactor o integrazioni, leggi documenti, configurazione e stato repo pertinenti.
- Per informazioni variabili su Shopify, eBay, App Store, API, piani, policy, billing o compliance, verifica fonti ufficiali aggiornate o pagine Shopify App Store correnti.
- Se la richiesta e ambigua su scope, comportamento atteso, rischio, deploy o pubblicazione, fai domande mirate prima di procedere.
- Procedi con un'assunzione dichiarata solo per dettagli marginali che non cambiano il risultato sostanziale.

## Disciplina di scope

- Mantieni le modifiche focalizzate sulla richiesta.
- Evita refactor, rinominazioni massive o riformattazioni non collegate.
- Preferisci patch piccole e coerenti.
- Non aggiungere nuove dipendenze, servizi o strumenti senza motivazione esplicita e impatto chiaro.
- Non inventare funzionalita non decise: se qualcosa e interessante ma non MVP, mettilo in roadmap/piano come futuro da valutare.

## Errori comuni da evitare

- Non promettere "real-time assoluto" indiscriminato: il target confermato e sync entro 5 minuti.
- Dove il real-time o quasi real-time e tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilita, preferiscilo e documenta il fallback.
- Non trasformare SyncBay in una app marketplace bidirezionale generica.
- Non assumere che Shopify sia la sorgente di verita: per il catalogo MVP la sorgente e eBay.
- Non aggiornare eBay con modifiche Shopify, salvo stock anti-overselling da ordini Shopify.
- Non cancellare prodotti Shopify quando un listing eBay sparisce: archiviali.
- Non sovrascrivere modifiche manuali Shopify senza aprire conflitto.
- Non dipendere dal supporto umano per errori ordinari: gli errori devono essere comprensibili e azionabili in dashboard.
- Non dedurre dati eBay non restituiti dalle API. Se un campo non arriva, dichiaralo come assente o non supportato.
- Non usare dati reali di merchant, ordini, clienti o listing in fixture, screenshot, log o documentazione.
- I file `.DS_Store` non fanno parte del repository: ignorali sempre e rimuovili se vengono tracciati per errore.

## Shopify ed eBay

### Shopify

- Usa Shopify Admin GraphQL come interfaccia primaria per prodotti, inventario, media e webhook.
- Mantieni compatibilita con Shopify CLI e app embedded.
- Prima di fissare scope o webhook, verifica la documentazione Shopify aggiornata.
- Tratta location, inventory item, product status, media e webhook come superfici critiche: impattano direttamente overselling e storefront.
- Per modifiche future alla UI embedded, usa pattern coerenti con Shopify Admin e Polaris/App Bridge quando saranno introdotti.

### eBay

- Per leggere tutti i listing attivi, prevedi Trading API dove serve, per coprire listing storici creati da Seller Hub/UI eBay.
- Usa Inventory API dove disponibile, soprattutto per casi compatibili con inventory/offer e aggiornamenti stock.
- Verifica sempre la documentazione eBay corrente per notifiche, OAuth, rate limit, marketplace account deletion e requisiti compliance.
- Non assumere che Inventory API copra tutti i listing di un merchant.

## Lingua, tono e prodotto

- Usa italiano come lingua predefinita con il maintainer.
- La UI merchant di SyncBay deve essere in italiano nella fase eBay.it-first, salvo integrazioni o termini tecnici Shopify/eBay che richiedano label originali.
- Tono UI: professionale, concreto, calmo. Frasi brevi, stato del sistema, azione successiva chiara.
- Evita emoji nella UI, esclamativi multipli, "oops" o messaggi vaghi.
- Mantieni identificatori nel codice in inglese quando coerente con librerie e framework.

## Sicurezza, privacy e dati

- Non committare segreti, token, credenziali, file `.env` reali o dati personali.
- Token Shopify/eBay devono essere cifrati a riposo quando verra implementato il runtime.
- Non stampare segreti in log, errori o risposte chat. Per verificarne la presenza usa controlli booleani, mai `echo $VAR`.
- Tratta dati shop, listing, ordini, clienti e immagini come dati merchant.
- Evita leak in log, fixture, screenshot, test o report.
- Per webhook pubblici e callback OAuth, valida sempre firma/HMAC/stato/nonce secondo il provider.
- Shopify GDPR webhook, disinstallazione app, revoca token e eBay marketplace account deletion devono restare requisiti di primo piano.

## Documentazione

SyncBay e attualmente guidata dalla documentazione. Aggiornala quando cambia una decisione stabile.

### Cosa aggiornare e quando

- `docs/syncbay-product-technical-plan.md`: perimetro prodotto, MVP, fasi, requisiti funzionali e rischi.
- `docs/market/shopify-ebay-app-benchmark.md`: benchmark competitivo e differenziazione.
- `ROADMAP.md`: priorita, backlog e stato decisioni/prossime fasi.
- `CHANGELOG.md`: storico modifiche significative.
- `docs/context.md`: handoff rapido per nuove chat o nuovi agenti.
- `docs/decisions-pending.md`: decisioni aperte e blocchi prima dello scaffold.
- `docs/data-model.md`: entita e regole dati concettuali.
- `docs/glossario.md`: terminologia prodotto e microcopy.
- `docs/guides/`: guide operative tematiche.
- `docs/guides/pre-scaffold-checklist.md`: prerequisiti prima di generare codice applicativo.
- `docs/guides/service-governance.md`: limiti MVP, retention, error handling e governance servizio.
- `docs/guides/git-e-pubblicazione.md`: policy Git/branch/PR/pubblicazione.
- `docs/decisions/`: decisioni architetturali o operative stabili.
- `docs/structure.md`: struttura repo prevista nella fase corrente.
- `README.md`: stato progetto, documenti principali e prossimo passo operativo.
- `SECURITY.md`: policy sicurezza root.
- `.env.example`: solo quando vengono decise nuove env var o scope necessari.
- `AGENTS.md`: regole operative per agenti e Codex.

Non creare documenti duplicati. Se serve dettaglio nuovo, preferisci integrare il piano principale o creare un ADR mirato.

Per modifiche solo documentali, non inventare test applicativi: rileggi i documenti toccati, verifica link interni e coerenza con il piano.

## Testing e verifica

Finche non esiste codice applicativo:

- per docs-only, usa almeno review del documento e, quando utile, `git diff --check`;
- non dichiarare test applicativi non eseguiti;
- se non esistono ancora test/build/lint, dichiararlo come limite normale della fase corrente.

Quando verra creato lo scaffold:

- aggiorna questo file con i comandi reali del repo;
- aggiungi gate per lint, test, build, typecheck, audit e verifiche browser quando pertinenti;
- mantieni i comandi allineati allo stack effettivamente generato.

## Git, commit e PR

- Usa commit atomici e messaggi Conventional Commit coerenti con l'impatto reale:
  - `docs:` per sola documentazione;
  - `feat:` per nuove funzionalita osservabili;
  - `fix:` per correzioni osservabili;
  - `chore:` per manutenzione interna;
  - `refactor:` solo per ristrutturazioni senza cambio funzionale;
  - `test:` per soli test;
  - `ci:` per workflow/CI.
- Prima di commit o PR, fai self-review del diff.
- Non aggiungere workflow GitHub Actions, policy deploy o release flow senza richiesta esplicita.
- Quando esistera un remote GitHub, usa branch dedicati `codex/<tema>` per lavori non banali, PR verso `main`, e pulizia branch dopo merge.
- Per docs-only sono sufficienti review contenuto e `git diff --check`, salvo documenti operativi critici.
- Se il maintainer chiede "pubblica", "deploya", "rilascia" o formule simili, interpreta la richiesta secondo le policy aggiornate di questa repo e non secondo Pratix, DocMolder o FiscalBay.
- In caso di dubbio tra commit, PR, deploy, release o pubblicazione App Store, fermati e chiedi conferma prima di azioni esterne o irreversibili.

Dettagli: `docs/guides/git-e-pubblicazione.md`.

## Release, deploy e App Store

Non esiste ancora un flusso di release/deploy per SyncBay.

Fino a decisione esplicita:

- non configurare deploy;
- non creare release versionate;
- non introdurre billing;
- non avviare pubblicazione Shopify App Store;
- non creare integrazioni produttive Shopify/eBay.

Quando questi flussi verranno decisi, aggiungi ADR e aggiorna `AGENTS.md`, `README.md`, `.env.example` e il piano tecnico.

## Risposte finali e handoff

Nelle risposte finali:

- riassumi cosa e cambiato o scoperto;
- indica i file principali toccati;
- riporta verifiche solo quando utili o quando ci sono limiti/rischi;
- dichiara rischi residui concreti;
- includi sempre i prossimi passi consigliati quando esiste un seguito operativo reale;
- i prossimi passi devono essere concreti, ordinati e proporzionati al lavoro appena concluso;
- se non c'e un prossimo passo utile, dichiaralo esplicitamente invece di forzare una lista generica.

Evita footer rituali sui test. Non inventare risultati.

## Definizione di completamento

Una modifica e pronta se:

- risolve la richiesta senza allargare inutilmente lo scope;
- resta coerente con perimetro e documenti di SyncBay;
- non introduce scaffold o runtime senza approvazione;
- non sovrascrive modifiche non tue;
- aggiorna documenti/ADR quando una decisione cambia davvero;
- non lascia segreti, dati personali, file temporanei o modifiche non correlate;
- include verifiche eseguite o limiti noti quando rilevanti.

## Sotto-moduli

Per regole specifiche di sotto-moduli, aggiungere `AGENTS.md` nelle relative sottocartelle.

Le istruzioni piu profonde prevalgono sui livelli superiori.
