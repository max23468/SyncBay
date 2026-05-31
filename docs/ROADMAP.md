# Roadmap - SyncBay

Documento vivo per direzione, priorità e prossimi passi correnti. Lo storico
esteso della vecchia roadmap di fondazione sta in
[`ROADMAP_HISTORY.md`](./ROADMAP_HISTORY.md); le idee non promosse stanno in
[`BACKLOG.md`](./BACKLOG.md).

## Ora

- Espandere l'import iniziale oltre il batch da 50 listing verso il limite MVP
  di 2.000 prodotti, mantenendo idempotenza, mapping, snapshot e audit.
- Rendere robusti batch, paginazione, retry e runner HTTP protetto per job
  `IMPORT_CATALOG` dovuti.
- Consolidare la dashboard operativa su stato connessioni, job recenti, storico
  import, conteggi mapping/snapshot e rimessa in coda manuale.
- Tenere sotto controllo sicurezza e dati: cifratura token, webhook GDPR,
  audit log, rate limit/retry e rollback import restano superfici prioritarie.

## Prossimo

- Avviare il sync incrementale eBay -> Shopify con fallback sostenibile.
- Implementare protezione disponibilità Shopify -> eBay per ordini pagati.
- Aggiungere regole prezzo Shopify-only, pulizia descrizioni eBay e gestione
  conflitti Shopify.
- Preparare screenshot prodotto e raffinamento microcopy quando la dashboard è
  abbastanza stabile.

## Più avanti

- Matching prodotti Shopify esistenti, varianti migliorate, multi-location
  avanzato e growth tier fino a 10.000 prodotti.
- Billing e app pubblica Shopify solo dopo privacy, governance, stabilità MVP e
  decisione esplicita sul modello commerciale.

## Bloccato

- App pubblica, billing e growth tier restano bloccati finché MVP, privacy,
  token, GDPR, rate limit e operatività sync non sono maturi.
- Nuove integrazioni provider o cambi infrastrutturali richiedono ADR o
  decisione dedicata.

## Fatto recente

- Fondazioni progetto, identità, GitHub, policy pubblicazione/versioning,
  runtime locale e ADR principali sono chiusi.
- Vercel, Supabase, Prisma, scaffold Shopify CLI React Router e primitive
  Supabase di osservabilità/coda/storage sono predisposti.
- Connessione Shopify custom app, OAuth eBay.it, onboarding guidato, import
  pilota idempotente e account deletion eBay sono verificati.

## Regole

- La roadmap non è un changelog.
- La roadmap non conserva lunghi elenchi `Fatto` come archivio.
- Le idee e i debiti non promossi stanno in `BACKLOG.md`.
- Le decisioni stabili stanno in `DECISIONS.md` o negli ADR.
- Aggiornare la roadmap solo quando cambia direzione, priorità, fase o backlog.
- Ogni voce attiva deve indicare un prossimo passo operativo reale.
