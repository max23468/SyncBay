# ADR 0021 - Cadenza cron e target sync in modalità risparmio egress

- **Stato**: Accettato
- **Data**: 2026-06-23
- **Decisori**: maintainer, Codex

## Contesto

Durante il pilota controllato, il consumo Supabase egress è rimasto il vincolo
operativo principale. Dopo la riduzione del batch automatico del runner a
`limit=5`, il tick Supabase Cron ogni 2 minuti resta una sorgente ricorrente di
query e connessioni anche quando non ci sono import o backfill attivi.

Il maintainer ha accettato che il target non sia più una promessa rigida
"entro massimo 5 minuti", ma una finestra indicativa e configurabile più
conservativa per rientrare nel limite gratuito Supabase.

## Decisione

La schedule Supabase Cron `syncbay-run-due-jobs` passa da ogni 2 minuti a ogni
5 minuti (`*/5 * * * *`).

L'intervallo target configurabile nelle Impostazioni passa ai soli valori:

- 5 minuti (`300` secondi);
- 10 minuti (`600` secondi);
- 15 minuti (`900` secondi);
- 20 minuti (`1200` secondi);
- 30 minuti (`1800` secondi).

Eventuali shop salvati sotto 5 minuti vengono normalizzati a 300 secondi dalla
migration. Valori fuori dall'insieme restano rifiutati lato server.

Il runner usa un look-ahead di 300 secondi, pari alla nuova cadenza cron, per
enqueueare nel tick corrente i sync incrementali che scadono prima del tick
successivo. Il look-ahead non anticipa `runAfter` usati come backoff provider.

Il batch automatico resta `limit=5`, come deciso dalla patch egress precedente.

## Conseguenze

- Le invocazioni automatiche del runner scendono da circa 30/ora a 12/ora.
- La capacità teorica del drain automatico scende, con `limit=5`, da circa
  150 job/ora a 60 job/ora.
- La freschezza ordinaria diventa più prudente: il minimo selezionabile è 5
  minuti e il massimo 30 minuti.
- L'app deve comunicare il target come finestra indicativa configurabile, non
  come SLA rigido.
- In caso di import/backfill massivi va valutata una corsia temporanea più
  aggressiva o un'esecuzione manuale controllata, senza rendere il polling
  ordinario più costoso.

## Alternative considerate

- **Restare a 2 minuti**: mantiene margine migliore sul target 5 minuti, ma non
  riduce abbastanza le invocazioni ricorrenti per il vincolo free tier.
- **Cron oltre 5 minuti**: più aggressivo sui costi, ma rende fragile anche
  l'opzione minima da 5 minuti e peggiora troppo la percezione del pilota.
- **Lasciare opzioni 2/3 minuti in UI**: scartato perché non coerente con una
  cadenza automatica ogni 5 minuti.

## Riferimenti

- `docs/decisions/0012-impostazioni-avanzate-disconnessione-intervallo.md`
- `docs/decisions/0019-cadenza-cron-runner.md`
- `app/lib/syncbay-sync-interval.ts`
- `app/services/sync-job-runner.server.ts`
- `prisma/migrations/20260623094000_set_runner_cron_five_minutes/migration.sql`
