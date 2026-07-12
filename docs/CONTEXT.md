# Contesto rapido — SyncBay

Questo è l'handoff operativo corrente. Per orientarsi nella documentazione usa
[`INDEX.md`](INDEX.md); per priorità e storico usa [`ROADMAP.md`](ROADMAP.md) e
[`ROADMAP_HISTORY.md`](ROADMAP_HISTORY.md).

## Stato corrente

- Fase: custom app privata 1.0, pronta per onboarding controllato di clienti
  selezionati dopo i gate di go-live.
- Produzione tecnica: Vercel production `https://syncbay.vercel.app`, distinta
  da Shopify App Store e billing.
- Store collegato: Numisleo; i dati del precedente ambiente pilota sono stati
  rimossi.
- Superfici embedded: Panoramica, Catalogo, Conflitti, Importazione, Attività e
  Impostazioni.
- Flussi implementati: OAuth Shopify/eBay, import controllato e takeover,
  sincronizzazione incrementale, conflitti Shopify, diagnostica, retry e stock
  eBay da ordini Shopify pagati.
- Runtime asincrono: record `SyncJob` su Postgres drenati dal runner HTTP
  protetto tramite Supabase Cron; le primitive Supabase Queues sono
  predisposte ma non sostituiscono questo percorso applicativo corrente.

## Vincoli non negoziabili

- eBay è la sorgente del catalogo; Shopify ne è la copia controllata.
- L'unica scrittura Shopify -> eBay è la disponibilità derivata dagli ordini.
- Target sync 5–30 minuti; limite 1.0 di 2.000 prodotti per shop.
- Listing eBay inattivi restano su Shopify come esauriti (ADR 0011).
- Modifiche manuali Shopify aprono conflitti e non vengono sovrascritte.
- UI embedded basata su Polaris Web Components Shopify (`s-*`).
- Nessun nuovo runtime, worker, provider o coda esterna senza decisione e ADR.

## Rischi e lavoro aperto

- Completare i gate di onboarding e il runbook per il primo cliente selezionato.
- Validare su dati correnti classificazione e azioni dei conflitti.
- Mantenere prioritari cifratura token, webhook GDPR, account deletion eBay,
  rate limit, retention e rollback.
- Billing, support policy pubblica e Shopify App Store restano decisioni future.

Le priorità operative dettagliate vivono esclusivamente in
[`ROADMAP.md`](ROADMAP.md); non duplicarle qui.

## Dove approfondire

| Tema | Fonte |
| --- | --- |
| Architettura e runtime | [`guides/architettura.md`](guides/architettura.md) |
| Import e onboarding | [`guides/onboarding-e-import.md`](guides/onboarding-e-import.md) |
| Sync, stock e conflitti | [`guides/sync-engine.md`](guides/sync-engine.md) |
| Provisioning provider | [`guides/provisioning-runtime.md`](guides/provisioning-runtime.md) |
| Comandi e verifiche | [`TOOLCHAIN.md`](TOOLCHAIN.md) |
| Decisioni stabili | [`DECISIONS.md`](DECISIONS.md) |
| Decisioni aperte | [`DECISIONS_PENDING.md`](DECISIONS_PENDING.md) |
| Git, publish e release | [`guides/git-e-pubblicazione.md`](guides/git-e-pubblicazione.md) |
