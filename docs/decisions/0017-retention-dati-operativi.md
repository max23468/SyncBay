# ADR 0017 - Retention dati operativi del pilota

- **Stato**: Accettato
- **Data**: 2026-06-20
- **Decisori**: maintainer, Codex

## Contesto

SyncBay registra dati operativi per import, sync, conflitti, audit, snapshot,
OAuth e notifiche eBay marketplace account deletion. Questi dati sono utili per
diagnostica, rollback, retry e compliance, ma non devono restare indefinitamente
nel runtime.

Il pilota è ancora limitato e non coincide con una privacy policy definitiva per
app pubblica Shopify App Store. Serve però una policy tecnica esplicita per
evitare accumulo non governato e per rendere leggibile cosa viene trattenuto.

Vincoli:

- conservare solo dati necessari a sync, rollback, conflitti e compliance;
- non salvare payload raw sensibili quando basta un riferimento minimizzato;
- non ridurre la capacità di diagnosi self-service ordinaria;
- rivedere la policy prima di beta pubblica, billing o App Store.

## Decisione

La retention operativa del pilota viene fissata così:

| Famiglia dati | Retention | Motivo |
| --- | ---: | --- |
| Audit webhook Shopify ricevuti | 30 giorni | Tracce ad alta frequenza già coperte da job e audit di esito; utili per diagnosi recente ma non come storico lungo. |
| Audit log operativi | 180 giorni | Tracciabilità azioni, retry, connessioni e diagnosi negoziante. |
| Job sync/import riusciti | 45 giorni | Esiti positivi recenti per diagnostica, con baseline conservate in snapshot e audit sintetici. |
| Job sync/import | 90 giorni | Diagnostica recente, code, retry e affidabilità senza storico indefinito. |
| Baseline prodotto corrente | Durata del mapping | Stato durevole usato da conflitti e viste correnti; non dipende dalla storia evento. |
| Snapshot prodotto evento | 30 giorni | Diagnostica e timeline recente ad alta densità. |
| Checkpoint prodotto settimanale | 180 giorni | Rollback storico compatto, solo quando completo e diverso dal checkpoint precedente. |
| State OAuth temporanei | 7 giorni | Anti-CSRF e debugging breve del flusso OAuth senza conservare stato vecchio. |
| Richieste eBay account deletion senza match | 7 giorni | Notifiche eBay non collegate ad alcuno shop del pilota, utili solo per deduplica e diagnostica breve. |
| Richieste eBay account deletion | 365 giorni | Idempotenza, compliance e prova di gestione richiesta senza payload raw. |

Queste finestre sono il riferimento per UI, documentazione, cleanup operativo e
future automazioni. Il cleanup automatico è stato implementato e attivato in
ADR 0018 (`docs/decisions/0018-cleanup-retention-automatico.md`).

La finestra a 365 giorni si applica alle notifiche account deletion collegate a
shop del pilota o comunque non classificate `NO_MATCH`. Le notifiche `NO_MATCH`
con `matchedShopCount = 0` non rappresentano un obbligo di prova verso un
negoziante SyncBay collegato e usano quindi la finestra stretta di 7 giorni.

Dal 2026-07-10, per contenere il limite database Supabase della distribuzione
privata, due famiglie rumorose hanno una finestra più breve senza cambiare le
baseline di sync: gli audit `SHOPIFY_WEBHOOK_RECEIVED` durano 30 giorni e i
`SyncJob` riusciti durano 45 giorni. Gli audit critici non-webhook restano a 180
giorni; i job falliti, cancellati o ancora attivi restano nella finestra
ordinaria di 90 giorni. I marker durevoli che impediscono di ripetere un facet
backfill già completato sono esclusi dal cleanup dei job riusciti.

Dal rollout dell'Ondata D, `ProductSyncBaseline` riceve la stessa scrittura
degli snapshot e resta finché esiste il mapping. `ProductSnapshotCheckpoint`
conserva al massimo un record per mapping, sorgente e settimana UTC. Un payload
oltre 64 KiB produce un checkpoint incompleto: in quel caso la snapshot sorgente
non viene cancellata prima dei 180 giorni. La compattazione resta disabilitabile
con il kill switch della retention e viene autorizzata solo dopo backfill e
verifica dei reader sulla baseline.

## Conseguenze

- La dashboard può spiegare la retention senza metriche o promesse vaghe.
- Il modello dati ha una policy minima prima di estendere import e sync.
- Alcuni dati diagnostici vecchi non saranno disponibili dopo cleanup.
- Prima dell'app pubblica servirà una revisione privacy/legal e una procedura di
  cancellazione verificata end-to-end.

## Alternative considerate

- **Conservazione indefinita**: scartata perché non proporzionata e difficile da
  giustificare in privacy.
- **Retention troppo breve per snapshot e audit**: scartata perché indebolisce
  rollback, conflitti e diagnosi self-service.
- **Policy unica per tutte le tabelle**: scartata perché OAuth state e account
  deletion hanno rischi e scopi diversi.

## Riferimenti

- `docs/data-model.md`
- `docs/DECISIONS_PENDING.md`
- `docs/decisions/0007-privacy-provvisoria-pilota.md`
- `app/lib/syncbay-retention-policy.ts`
