# Roadmap - SyncBay

Documento vivo per direzione, priorità e prossimi passi correnti. Lo storico
esteso della vecchia roadmap di fondazione sta in
[`ROADMAP_HISTORY.md`](./ROADMAP_HISTORY.md); le idee non promosse stanno in
[`BACKLOG.md`](./BACKLOG.md).

## Ora

- Modellare nel tab Importazione la modalità generica `Collega catalogo
  esistente` per la 1.0 custom privata: matching conservativo, dry-run,
  eccezioni, report e apply controllato, senza funzioni Numisleo-specifiche.
- Preparare privacy policy generale SyncBay, termini d'uso minimi e mini kit
  per clienti selezionati prima del primo go-live privato.
- Verificare in produzione privata le nuove classificazioni dei conflitti su
  coda reale: `Sicuri`, `Da rivedere`, `Da decidere`.
- Raccogliere screenshot prodotto puliti delle sei superfici embedded
  ridisegnate, usando dati reali o fixture sintetiche realistiche senza dati
  personali.
- Estendere la diagnostica self-service verso rollback per prodotto dopo il
  primo pass su impatto job, prossima azione e retry sicuro.
- Tenere sotto controllo sicurezza e dati: cifratura token, webhook GDPR,
  audit log, rate limit/retry e rollback import restano superfici prioritarie.

## Prossimo

- Misurare con `npm run descriptions:cleanup-report` sui dati reali importati se
  restano segnali template residui nelle descrizioni e approfondire la pulizia
  eBay solo se la misura lo giustifica. Il cleaner attuale rimuove già blocchi
  template, attributi/colori, tabelle template e code legali/spedizione; i
  limiti noti sono le frasi template tarate su Numisleo e le tabelle di
  specifiche legittime appiattite a testo.
- Rafforzare la vista Attività con dettagli operativi progressivi quando i
  volumi reali rendono chiari i pattern di errore.
- Eseguire audit e dry-run del primo store reale solo dopo aver chiuso la
  modalità catalogo esistente e il runbook di freeze/takeover.

## Più avanti

- Matching prodotti Shopify esistenti, varianti migliorate, multi-location
  avanzato e growth tier fino a 10.000 prodotti.
- Billing e app pubblica Shopify solo dalla 2.0, dopo privacy, governance,
  stabilità 1.0 privata e decisione esplicita sul modello commerciale.

## Bloccato

- App pubblica, billing e growth tier restano bloccati fino alla 2.0; la 1.0 è
  custom privata per pochi clienti selezionati.
- Nuove integrazioni provider o cambi infrastrutturali richiedono ADR o
  decisione dedicata.

## Completato

Lo storico delle attività concluse vive in
[`ROADMAP_HISTORY.md`](ROADMAP_HISTORY.md) e nel changelog; non viene duplicato
in questa roadmap operativa.

## Regole

- La roadmap non è un changelog.
- La roadmap non conserva lunghi elenchi `Fatto` come archivio.
- Le idee e i debiti non promossi stanno in `BACKLOG.md`.
- Le decisioni stabili stanno in `DECISIONS.md` o negli ADR.
- Aggiornare la roadmap solo quando cambia direzione, priorità, fase o backlog.
- Ogni voce attiva deve indicare un prossimo passo operativo reale.
