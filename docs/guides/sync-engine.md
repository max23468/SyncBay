# Guida sync engine

Questa guida descrive il comportamento atteso del motore di sincronizzazione.

## Promessa

SyncBay promette sync entro massimo 5 minuti, non real-time assoluto indiscriminato.

Dove il real-time o quasi real-time e tecnicamente possibile senza impatto eccessivo su prestazioni, rate limit, costi o stabilita, va raggiunto. Il polling entro 5 minuti resta obbligatorio come fallback e riconciliazione.

## Sorgente di verita

- Catalogo: eBay.
- Prezzo base: eBay.
- Prezzo Shopify pubblicato: calcolato da SyncBay con regole Shopify-only.
- Disponibilita: eBay, con eccezione aggiornamento da ordini Shopify per ridurre il rischio di vendere prodotti non disponibili.
- Campi protetti Shopify: gestiti con modalita mirror controllato.

## Priorita job

1. Stock dopo ordine Shopify.
2. Quantita/prezzo eBay -> Shopify.
3. Titolo/descrizione/immagini.
4. Archiviazione prodotti chiusi.
5. Riconciliazione completa.

## Modalita mirror controllato

Ogni campo puo essere:

- controllato da eBay;
- controllato da Shopify;
- calcolato da SyncBay;
- ignorato dal sync.

Se Shopify cambia manualmente un campo controllato da eBay o SyncBay, aprire conflitto.

## Protezione disponibilita

Default:

- trigger: ordine Shopify pagato;
- update eBay prioritario;
- retry con backoff;
- alert critico se fallisce;
- stock buffer configurabile;
- modalita prudente se lo stock non e affidabile.

## Riconciliazione

Il polling incrementale deve essere affiancato da riconciliazione completa periodica per correggere drift, eventi persi e notifiche non ricevute.

Runtime previsto:

- Supabase Cron come scheduler primario per polling e drenaggio queue;
- Supabase Queues come coda persistente per job e retry;
- Vercel per endpoint HTTP, OAuth e webhook;
- batch piccoli e riprendibili, non funzioni lunghe monolitiche.

## Diagnostica

Ogni job fallito deve conservare:

- provider;
- prodotto/listing;
- operazione;
- errore normalizzato;
- impatto;
- prossima azione consigliata;
- retry sicuro si/no.

## Vincoli runtime

Il runtime MVP e definito in ADR `docs/decisions/0005-runtime-infrastructure.md`.

Regole per il motore sync:

- non affidare import o riconciliazioni a una singola funzione lunga;
- spezzare import e sync in batch piccoli;
- usare lock/idempotency key per evitare doppie scritture provider;
- rendere ogni job riprendibile dopo timeout, deploy o errore provider;
- conservare diagnostica e stato avanzamento per shop/prodotto/job.

Se i batch serverless non bastano, mantenere Supabase Queues/Postgres e spostare solo il consumer su worker dedicato.
