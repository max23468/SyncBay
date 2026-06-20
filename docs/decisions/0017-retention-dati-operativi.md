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
| Audit log operativi | 180 giorni | Tracciabilità azioni, retry, connessioni e diagnosi negoziante. |
| Job sync/import | 90 giorni | Diagnostica recente, code, retry e affidabilità senza storico indefinito. |
| Snapshot prodotto | 180 giorni | Conflitti, rollback e confronto con ultimo valore scritto da SyncBay. |
| State OAuth temporanei | 7 giorni | Anti-CSRF e debugging breve del flusso OAuth senza conservare stato vecchio. |
| Richieste eBay account deletion | 365 giorni | Idempotenza, compliance e prova di gestione richiesta senza payload raw. |

Queste finestre sono il riferimento per UI, documentazione, cleanup operativo e
future automazioni. Il cleanup automatico resta da implementare o schedulare in
modo esplicito prima della beta pubblica.

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
