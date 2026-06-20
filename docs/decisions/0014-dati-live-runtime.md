# ADR 0014 - Dati live nel runtime: polling leggero, toast e transizioni

- **Stato**: Accettato
- **Data**: 2026-06-14
- **Decisori**: maintainer, Claude

## Contesto

Il redesign (ADR 0010 esteso, ADR 0013) ha reso la Panoramica più informativa,
ma le pagine restano SSR pure: i dati si aggiornano solo ricaricando, le azioni
non danno feedback immediato e la navigazione non ha continuità. Il maintainer
ha chiesto un'app più "viva".

Verifica preliminare importante: `getDashboardState` **non fa chiamate di rete
ai provider**. È tutto query DB in transazione + letture di config sincrone (lo
stato eBay arriva dal record in DB, non da un ping eBay). Quindi il loader è già
veloce e **lo streaming `defer` non porta benefici**: non esiste un segmento
lento da differire. Introdurlo aggiungerebbe complessità e romperebbe il
contratto del loader e l'harness di preview, senza guadagno.

## Decisione

Niente `defer`. Si rende l'app viva con tre leve client, dentro l'admin
embedded:

1. **Polling leggero (revalidation).** Un componente client rivalida il loader
   a intervalli **solo quando c'è lavoro in corso** (job attivi/in coda) e la
   tab è in primo piano; si ferma quando non c'è lavoro o la tab è in
   background. Intervallo prudente (ordine di ~15 s). Costo: ripete query DB
   leggere, nessuna chiamata provider, nessun nuovo worker. Quando il lavoro
   finisce, il polling si spegne da solo.
2. **Toast App Bridge.** `useAppBridge().toast.show(...)` per gli esiti: sulla
   Panoramica, quando una sincronizzazione in corso si completa tra due
   revalidation; sulle superfici con azioni (Conflitti, Attività) come esito di
   retry/risoluzione, in fase di propagazione.
3. **Transizioni di navigazione: RIMOSSE (aggiornamento 2026-06-19).** L'opt-in
   CSS `@view-transition { navigation: auto }` era stato aggiunto come
   miglioramento progressivo, ma la navigazione embedded passa per App Bridge e
   per gli anchor dei web component `s-*` (non per `<Link>` di React Router),
   quindi non produceva una transizione verificabile su questi percorsi. Non
   essendo confermabile né nell'harness né senza convertire la navigazione a
   `<Link>` RR, è stata rimossa per non lasciare codice morto. Si potrà
   rivalutare se e quando la navigazione interna passerà a `<Link>` RR.

## Conseguenze

- L'app sembra viva quando lavora, senza costo quando è ferma.
- Il polling ripete query DB: prudente, legato allo stato "in lavoro", in primo
  piano. Da rivedere se la scala dei job cresce molto.
- I comportamenti vivono solo nell'admin reale (App Bridge): l'harness statico
  non li mostra, la verifica locale è typecheck/lint/build + ragionamento.
- Le transizioni di navigazione sono fuori finché la navigazione interna non
  passa a `<Link>` RR (vedi aggiornamento 2026-06-19).
- Se in futuro il loader dovesse fare ping provider lenti, `defer` andrà
  rivalutato (questa ADR non lo vieta in assoluto, lo esclude oggi per assenza
  di segmenti lenti).

## Alternative considerate

- **Streaming `defer`**: scartato perché il loader è DB-bound, niente da
  differire.
- **Polling fisso sempre attivo**: scartato per costo inutile quando l'app è
  ferma; si lega lo stato "in lavoro".
- **WebSocket / push realtime**: fuori scope MVP e sproporzionato al target
  "entro 5 minuti".

## Riferimenti

- `docs/decisions/0010-ui-design-layer-e-marchi-terzi.md`
- `docs/decisions/0013-accento-ui-bay-blue-e-tema.md`
- `app/routes/app._index.tsx`
- `app/services/syncbay.server.ts` (`getDashboardState`)
