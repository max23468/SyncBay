# AGENTS.md — servizi runtime

Integra il file root per `app/services/**`. Per i gate vale la riga
`app/services` di `docs/TOOLCHAIN.md`, più i test mirati del modulo toccato.

Per prompting, autonomia, skill e delega applica anche la sezione
[Prompting e conduzione del lavoro con Astra](../../AGENTS.md#prompting-e-conduzione-del-lavoro-con-astra)
del file root; i gate dei servizi restano quelli indicati sopra.

## Significato di `Pubblica`

Quando il proprietario, riferendosi alla repository o alla modifica corrente,
dice `Pubblica` o chiede in modo affermativo e inequivocabile di pubblicare,
autorizza l'intero ciclo tecnico applicabile. Domande, ipotesi, pianificazioni e
negazioni non costituiscono autorizzazione. L'agente non si ferma a stati
intermedi e completa tutti i passaggi applicabili: preparazione e verifiche,
branch e commit, versione e changelog quando richiesti, push, PR, soli gate
bloccanti, merge, tag e GitHub Release quando previsti, deploy o promozione
tecnica e verifica live. La sequenza concreta, in particolare tra versionamento,
merge, deploy e release, è quella definita dalla policy della repository.

La pulizia finale rimuove soltanto branch e worktree temporanei creati nel ciclo
corrente e già assorbiti; controlla stash e altri residui senza alterare elementi
preesistenti o estranei alla pubblicazione. Se un passaggio non è applicabile, lo
dichiara e prosegue con gli altri. La richiesta affermativa di pubblicazione
vale come autorizzazione a PR, merge, deploy tecnico e release previsti dal
ciclo, senza una seconda conferma. Non autorizza pubblicazione di temi Shopify
live, submission Shopify App Store, billing o nuove attivazioni produttive,
TestFlight o App Store, invii Aruba, email o scansioni reali, né aggiornamenti
Notion: queste azioni richiedono una richiesta esplicita separata. Una richiesta
riferita soltanto a una di queste azioni non avvia la pubblicazione della
repository. Non dichiarare `pubblicato` finché il ciclo applicabile e la
rilettura finale di PR, check, deploy, release e stato Git non sono completi.

## Ownership

- `sync-job-runner.server.ts`: coordinamento sottile del tick; scheduling/claim
  e le famiglie import, incrementale, stock e conflitti vivono nei moduli
  `sync-job-*.server.ts` dedicati.
- `syncbay-state.server.ts`, `syncbay-catalog.server.ts`,
  `syncbay-import.server.ts`, `syncbay-product-updates.server.ts` e
  `syncbay-operations.server.ts`: superfici route separate per letture, catalogo,
  importazione, aggiornamenti prodotto e comandi operativi.
- `shopify-draft-import.server.ts` coordina l'import; prodotti/varianti,
  inventario, media e persistenza vivono nei rispettivi moduli
  `shopify-import-*.server.ts`.
- `shopify-existing-products.server.ts`: scansione e matching conservativo del
  catalogo Shopify esistente.
- `shopify-conflict-detection.server.ts`: letture Shopify aggregate e apertura
  conflitti per mapping.
- `crypto.server.ts`, sessioni e adapter Shopify Admin: cifratura, refresh e
  accesso autenticato.

## Confini da preservare

- Il runner è l'unico proprietario delle transizioni dei job in esecuzione: non
  duplicare claim, completamento o recovery in route e script.
- La logica deterministica riusata o non banale sta in `app/lib` con test puri;
  una condizione triviale propria di un solo flusso resta nel chiamante ed è
  coperta dal test del servizio. I servizi coordinano Prisma e provider.
- Usa gli adapter e le primitive Shopify condivise: niente fetch, retry o
  decifratura paralleli dentro un singolo servizio.
- Un errore provider o di una singola riga non promuove a successo l'intero
  batch né lascia job `RUNNING` dopo la fine della richiesta.
- Runner e import sono gli hotspot principali: se il comportamento richiesto
  appartiene a una sola superficie, non toccare le altre.
