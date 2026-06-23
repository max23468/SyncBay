# ADR 0018 - Cleanup retention automatico

- **Stato**: Accettato
- **Data**: 2026-06-20
- **Decisori**: maintainer, Codex

## Contesto

ADR 0017 ha fissato le finestre di retention operativa del pilota (audit 180
giorni, job 90, snapshot 180, OAuth state 7, richieste account deletion senza
match 7, richieste account deletion collegate 365), ma lasciava esplicitamente
aperto il cleanup: «resta da implementare o schedulare in modo esplicito prima
della beta pubblica».

Finché il cleanup non è automatico, i dati scaduti restano nel runtime, in
contraddizione con la policy dichiarata e con l'obiettivo di non accumulare dati
non governati. Il maintainer ha richiesto di attivare da subito la cancellazione
automatica.

Vincoli:

- rispettare i cutoff per area definiti in ADR 0017, senza inventarne di nuovi;
- non degradare la diagnostica self-service ordinaria (le finestre restano
  quelle di ADR 0017);
- mantenere la cancellazione osservabile e disattivabile;
- non introdurre un nuovo runtime, worker o workflow fuori dallo scaffold.

## Decisione

Il cleanup retention diventa automatico ed è eseguito nel tick del cron job
esistente (`runDueSyncJobs`, invocato da `api.jobs.run-due` via Supabase Cron),
senza nuovi worker né workflow.

- La pianificazione dei cutoff è deterministica e testata
  (`app/lib/syncbay-retention-cleanup.ts`), separata dall'esecuzione.
- L'esecuzione distruttiva vive in `app/services/retention-cleanup.server.ts`:
  per ogni area cancella i record con timestamp anteriore o uguale al cutoff. È
  idempotente, quindi può girare a ogni tick; dopo il primo allineamento tocca
  solo i pochi record appena scaduti.
- I job vengono cancellati solo se in stato terminale
  (`SUCCEEDED`/`FAILED`/`CANCELLED`), per non rimuovere lavoro ancora in coda.
- Le richieste eBay account deletion `NO_MATCH` con `matchedShopCount = 0`
  seguono una finestra stretta di 7 giorni; la retention a 365 giorni esclude
  questi record e resta dedicata alle richieste non `NO_MATCH`.
- La cancellazione è abilitata per default e disattivabile con
  `SYNCBAY_RETENTION_CLEANUP_ENABLED=false`, che riporta al solo comportamento di
  pianificazione (dry-run) senza cancellare.
- I conteggi rimossi sono loggati e inclusi nella risposta del cron, così la
  cancellazione resta osservabile.
- La manutenzione delle tabelle interne Supabase non contenenti dati
  applicativi (`cron.job_run_details` e `net._http_response`) è separata dalla
  retention SyncBay: una migration crea un cron giornaliero
  `syncbay-maintain-supabase-internal-tables` che conserva 7 giorni di dettagli
  `pg_cron` e 1 giorno di risposte `pg_net`.

## Conseguenze

- I dati scaduti non si accumulano più: il runtime rispetta la policy di ADR 0017
  in modo automatico.
- La cancellazione è distruttiva e ricorrente: dati diagnostici oltre la finestra
  non sono più recuperabili. È un effetto voluto e coerente con ADR 0017.
- Gli snapshot oltre 180 giorni vengono rimossi anche se fossero baseline di un
  conflitto molto vecchio ancora aperto: caso limite accettato, da rivedere se
  emergesse in produzione.
- Prima dell'app pubblica resta da verificare end-to-end la cancellazione e da
  allinearla alla privacy policy definitiva.

## Alternative considerate

- **Job schedulato dedicato con nuovo `SyncJobType` e migration**: scartato per
  ora perché aggiungeva uno stato a schema e una migration distruttiva senza
  vantaggi rispetto all'esecuzione idempotente nel tick esistente.
- **Solo dry-run/report senza cancellazione**: scartato perché non chiude il
  punto aperto di ADR 0017 e non rispetta la richiesta di attivazione.
- **Guardia giornaliera esplicita**: non necessaria, perché la cancellazione per
  cutoff è già idempotente e a basso costo dopo il primo allineamento.

## Riferimenti

- `docs/decisions/0017-retention-dati-operativi.md`
- `app/lib/syncbay-retention-policy.ts`
- `app/lib/syncbay-retention-cleanup.ts`
- `app/services/retention-cleanup.server.ts`
- `.env.example`
- `prisma/migrations/20260621100000_egress_maintenance_actions/migration.sql`
