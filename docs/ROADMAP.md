# Roadmap - SyncBay

Documento vivo per direzione, priorità e prossimi passi correnti. Lo storico
esteso della vecchia roadmap di fondazione sta in
[`ROADMAP_HISTORY.md`](./ROADMAP_HISTORY.md); le idee non promosse stanno in
[`BACKLOG.md`](./BACKLOG.md).

## Ora

- Verificare in produzione pilota le nuove classificazioni dei conflitti su
  coda reale: `Batch sicuri`, `Da rivedere`, `Manuali`.
- Raccogliere screenshot prodotto puliti delle sei superfici embedded, usando
  dati reali o fixture sintetiche realistiche senza dati personali.
- Estendere la diagnostica self-service verso rollback per prodotto dopo il
  primo pass su impatto job, prossima azione e retry sicuro.
- Tenere sotto controllo sicurezza e dati: cifratura token, webhook GDPR,
  audit log, rate limit/retry e rollback import restano superfici prioritarie.

## Prossimo

- Aggiungere regole prezzo Shopify-only e pulizia descrizioni eBay più profonda.
- Rafforzare la vista Attività con dettagli operativi progressivi quando i
  volumi reali rendono chiari i pattern di errore.

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
- Il primo ciclo incrementale reale eBay -> Shopify e il flusso ordine Shopify
  pagato -> aggiornamento disponibilità eBay sono stati verificati sul dev store
  e ripristinati dopo il test.
- Il redesign embedded a sei superfici è stato implementato, pubblicato e
  rivisto post-publish contro i concept finali.
- La UI embedded classifica i conflitti per sicurezza operativa e la timeline
  Attività spiega impatto, prossima azione e retry sicuro dei job.
- Coda conflitti pilota verificata e ripulita: 933 falsi positivi `description`
  riallineati con repair script e 41 falsi positivi `images` chiusi dalla nuova
  regola che ignora il conflitto quando eBay non ha media e Shopify sì.

## Regole

- La roadmap non è un changelog.
- La roadmap non conserva lunghi elenchi `Fatto` come archivio.
- Le idee e i debiti non promossi stanno in `BACKLOG.md`.
- Le decisioni stabili stanno in `DECISIONS.md` o negli ADR.
- Aggiornare la roadmap solo quando cambia direzione, priorità, fase o backlog.
- Ogni voce attiva deve indicare un prossimo passo operativo reale.
