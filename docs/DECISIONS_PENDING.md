# Decisioni aperte

Qui vivono solo decisioni non ancora chiuse. Le decisioni accettate stanno in
[`DECISIONS.md`](DECISIONS.md) e negli ADR; idee e debiti non promossi stanno in
[`BACKLOG.md`](BACKLOG.md).

Non trasformare una voce in codice senza conferma del maintainer. Quando viene
chiusa, crea o aggiorna l'ADR pertinente e rimuovila da questo file.

## Evoluzioni private

| Decisione | Default 1.0 | Perché conta |
| --- | --- | --- |
| Multi-location avanzato | Una location Shopify predefinita | Impatta disponibilità e rischio di vendere prodotti non disponibili. |
| Varianti complesse | Supporto semplice con esclusione guidata | Impatta la copertura dell'import. |
| Policy production stabile | Produzione Vercel privata controllata | Serve prima di promozioni o nuovi clienti su scala maggiore. |

## App pubblica

| Decisione | Default attuale | Perché conta |
| --- | --- | --- |
| Billing | Fuori dalla custom app privata | Necessario per una distribuzione pubblica. |
| Shopify App Store listing | Dopo stabilità della 1.0 privata | Richiede contenuti, review, billing e compliance. |
| Support policy | Self-service first | Il prodotto non deve dipendere da supporto umano ordinario. |
| Multi-marketplace | Fuori scope | Rischia di diluire il posizionamento eBay.it-first. |
| Promozione production/App Store | Nessuna equivalenza con Vercel production privata | Richiede policy, gate e decisione esplicita. |
