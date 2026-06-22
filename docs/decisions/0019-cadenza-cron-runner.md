# ADR 0019 - Cadenza Supabase Cron del runner

- **Stato**: Sostituito da ADR 0021
- **Data**: 2026-06-20
- **Decisori**: maintainer, Codex

## Contesto

Il runner `/api/jobs/run-due` era richiamato da Supabase Cron ogni minuto. La
diagnosi sull'egress Supabase ha mostrato che il consumo anomalo principale era
legato agli snapshot prodotto letti dal Catalogo, ma il polling automatico resta
una sorgente ricorrente di traffico e query anche quando non ci sono job dovuti.

SyncBay promette sync entro massimo 5 minuti, non real-time assoluto. La
configurazione precedente permetteva anche un target negoziante a 60 secondi,
che richiedeva un tick automatico almeno ogni minuto per essere credibile.

## Decisione

La schedule Supabase Cron `syncbay-run-due-jobs` passa da ogni minuto a ogni 2
minuti (`*/2 * * * *`).

Per mantenere coerenza di prodotto, il target minimo configurabile nelle
Impostazioni passa da 60 a 120 secondi. Eventuali shop già salvati a 60 secondi
vengono normalizzati a 120 secondi dalla migrazione.

Il target massimo resta 5 minuti. `syncTargetSeconds` continua a guidare
`getNextIncrementalEnqueueAt` e la soglia "in ritardo"; cambia solo il floor
operativo.

Il runner usa un look-ahead di 120 secondi, pari alla cadenza del cron: quando
un sync incrementale scade prima del tick successivo, viene già enqueueato nel
tick corrente. Questo mantiene la promessa "entro massimo 5 minuti" anche con
la schedule ogni 2 minuti. Il look-ahead non anticipa `runAfter` usati come
backoff provider, per esempio pause eBay Trading rate-limit.

## Conseguenze

- Meno tick automatici a vuoto su Supabase Cron e sul backend Vercel.
- Nessuna promessa UI o configurazione resta a 1 minuto.
- Un job dovuto entro il tick successivo viene anticipato dal look-ahead del
  runner, evitando che il target massimo di 5 minuti slitti fino alla finestra
  cron successiva.
- Il cambio non modifica code, dati catalogo, ordini o integrazioni provider.

## Alternative considerate

- **Mantenere Cron ogni minuto**: corretto per il target 60 s, ma meno efficace
  per ridurre polling a vuoto.
- **Passare a 2 minuti lasciando l'opzione 1 minuto**: scartato perché avrebbe
  reso impossibile rispettare il target configurato a 60 s senza invocazioni
  manuali del runner.
- **Aumentare oltre 2 minuti**: scartato per non comprimere troppo il margine
  operativo rispetto al target massimo di 5 minuti.

## Riferimenti

- `docs/decisions/0012-impostazioni-avanzate-disconnessione-intervallo.md`
- `app/lib/syncbay-sync-interval.ts`
- `prisma/migrations/20260620224500_set_run_due_cron_two_minutes/migration.sql`
