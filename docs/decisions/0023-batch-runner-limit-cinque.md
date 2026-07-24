# ADR 0023 - Batch del runner a `limit=5`

- **Stato**: Accettato
- **Data**: 2026-07-24
- **Decisori**: maintainer, Claude

## Contesto

ADR 0021 ha fissato il batch automatico del runner a `limit=2` per contenere
l'egress Supabase, con la formula esplicita: «La capacità non viene recuperata
alzando il limite». La cadenza Supabase Cron di 5 minuti e il target di sync
configurabile 5-30 minuti restano validi e non sono in discussione qui.

Il vincolo si è rivelato mal calibrato per un carico specifico: il reconcile
catalogo. Ogni giro spezza l'intero catalogo in batch da massimo 10 item eBay —
su un catalogo da circa 1.300 prodotti sono ~100 job accodati in un istante
solo, con lo stesso `runAfter`. A 2 slot per tick il giro impiegava fra 4,75 e
9 ore, misurate su nove giri consecutivi fra il 14 e il 24 luglio 2026.

Due osservazioni cambiano il quadro rispetto al 2026-06-23:

1. **Il volume del reconcile è fisso, non proporzionale al limite.** I ~100
   batch vanno comunque eseguiti tutti prima del giro successivo. Eseguirli in
   due ore invece che in sei non cambia il totale di query, connessioni e byte:
   ne cambia solo la distribuzione nel tempo. Il limite non è un rubinetto sul
   consumo del reconcile, è la sua durata.
2. **Fuori dai giri di reconcile il limite non ha effetto.** Il runner claima
   solo job dovuti; a coda vuota — la condizione ordinaria, con 8-12 delta
   eventi l'ora e nient'altro — esce subito, con `limit=2` come con `limit=5`.
   Il consumo ricorrente che ADR 0021 voleva ridurre dipende dalla cadenza cron,
   non dal batch.

I log di produzione del 2026-07-24 mostrano inoltre capacità inutilizzata a ogni
tick: `processedCount=2`, `elapsedMs` fra 6.671 e 14.773, `continuationNeeded:
true`. Ogni invocazione chiudeva con circa 55 secondi liberi dentro la propria
finestra e lavoro ancora in coda.

## Decisione

Il batch automatico passa da `limit=2` a `limit=5`, cioè
`DEFAULT_RUN_DUE_LIMIT` di `app/lib/syncbay-job-scheduling.ts`. La modifica vive
nella query string del secret Supabase Vault `syncbay_run_due_url`, letta dalla
schedule `syncbay-run-due-jobs`: nessuna modifica al codice applicativo.

Restano invariati da ADR 0021: cadenza cron `*/5 * * * *`, insieme dei target di
sync selezionabili, assenza di look-ahead sui `runAfter`, deadline interna di 70
secondi e timeout `pg_net` di 90 secondi.

Il tetto effettivo non è il limite ma la deadline: i job di uno stesso shop
girano in serie e `shouldClaimRunnerJob` smette di claimare negli ultimi 5
secondi della finestra. Con batch reconcile da ~10-15 secondi l'uno, un tick ne
assorbe 4-5 e lascia il resto al tick successivo. `limit=5` è quindi il valore
oltre il quale il limite non è più il vincolo attivo, non un aumento aperto.

## Misura

Primo tick dopo la modifica, in produzione il 2026-07-24 alle 21:25 UTC:

```
processedCount=5  failedCount=0  elapsedMs=26887  continuationNeeded=true
```

Cinque job in 27 secondi — un delta eventi più quattro batch reconcile — contro
i 70 secondi di deadline interna. I quattro tick precedenti, con `limit=2`,
chiudevano a `processedCount=2` in 6,7-14,8 secondi.

## Conseguenze

- Un giro di reconcile passa da 4,75-9 ore a circa 2 ore, riducendo la finestra
  in cui la coda incrementale resta occupata da lavoro di manutenzione.
- Il volume totale di egress per giro di reconcile non cambia; cambia la sua
  concentrazione. Il picco di chiamate eBay e Shopify per unità di tempo sale
  proporzionalmente e va osservato contro i rate limit provider.
- A code vuote il comportamento è identico a prima: nessun costo aggiuntivo nel
  funzionamento ordinario.
- L'overhead per job svolto scende: meno avvii di funzione a parità di lavoro.
- Va rivisto se il numero di shop attivi cresce: con più shop i gruppi girano in
  parallelo e la deadline smette di essere il tetto naturale per invocazione.

## Alternative considerate

- **Restare a `limit=2`**: nessun rischio nuovo, ma conserva una finestra di
  4,75-9 ore per giro in cui il reconcile occupa la corsia incrementale. Dopo il
  fix di priorità dei delta la finestra non blocca più la sincronizzazione live,
  quindi l'alternativa era sostenibile — solo lenta senza motivo.
- **Limite temporaneo alzato solo durante i giri di reconcile**: richiede logica
  adattiva nel runner o un intervento manuale ricorrente, per un beneficio che
  `limit=5` ottiene senza codice, dato che a coda vuota il limite è inerte.
- **Alzare oltre 5**: inutile. La deadline di 70 secondi limita comunque a 4-5
  job per tick di uno stesso shop; il resto verrebbe solo scartato come
  `skipped`.

## Riferimenti

- `docs/decisions/0021-cadenza-cron-e-target-risparmio-egress.md`
- `docs/decisions/0019-cadenza-cron-runner.md`
- `app/lib/syncbay-job-scheduling.ts` (`DEFAULT_RUN_DUE_LIMIT`)
- `app/lib/syncbay-runner-fairness.ts` (`buildRunnerLanePlan`,
  `shouldClaimRunnerJob`)
- `docs/guides/provisioning-runtime.md`
