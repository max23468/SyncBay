# Checklist scaffold e adattamento SyncBay

Questa checklist traccia i prerequisiti chiusi prima dello scaffold e lo stato minimo dopo la generazione/adattamento del runtime Shopify CLI React Router.

## 1. Repo e documentazione

- [x] Primo commit docs di fondazione creato.
- [x] Remote GitHub deciso e configurato: https://github.com/max23468/SyncBay
- [x] Branch policy provvisoria documentata.
- [x] `AGENTS.md` riletto e coerente con lo stato reale.
- [x] `docs/decisions-pending.md` aggiornato.
- [x] Decisioni tecniche bloccanti spostate in ADR quando chiuse.
- [x] Scaffold Shopify CLI React Router creato.

## 2. Account Shopify

- [x] Account Shopify Partner disponibile.
- [x] Development store disponibile: `syncbay-dev.myshopify.com`.
- [x] Nome app custom confermato: `SyncBay`.
- [x] Shopify CLI collegata all'app `SyncBay`.
- [x] App URL provvisorio deciso: `https://syncbay.vercel.app`.
- [x] Redirect URL Shopify provvisorio deciso: `https://syncbay.vercel.app/auth/callback`.
- [x] Scopes Shopify iniziali definiti come bozza MVP.
- [x] Webhook minimi definiti come bozza MVP: uninstall, orders, products, inventory.
- [x] Webhook minimi configurati nello scaffold come placeholder tracciati, escluso `orders/paid` finche Shopify non approva/configura protected customer data.

## 3. Account eBay

- [x] Account eBay Developer disponibile.
- [ ] App/keyset eBay SyncBay approvato (richiesto a eBay, in attesa).
- [x] Marketplace iniziale confermato: `EBAY_IT`.
- [ ] OAuth RuName e accept/reject URL decisi (in attesa keyset/app URL).
- [x] Scope eBay necessari definiti come bozza MVP e verificati su documentazione corrente.
- [x] Strategia Trading API + Inventory API confermata.
- [x] Marketplace account deletion notification/opt-out verificato come requisito.

## 4. Decisioni tecniche bloccanti

- [x] Hosting scelto o fallback locale chiaro: Vercel.
- [x] Progetto Vercel creato e collegato: `matteos-projects-9226d217/syncbay`.
- [x] Database scelto: Supabase Postgres.
- [x] Progetto Supabase creato e collegato: `mgjcbuokppfnglsftsmi`.
- [x] Migration Prisma iniziali applicate su Supabase.
- [x] ORM scelto: Prisma.
- [x] Job queue scelta: Supabase Queues.
- [x] Storage temporaneo immagini deciso: Supabase Storage privato, staging con retention breve.
- [x] Strategia segreti/cifratura decisa: provider secrets + cifratura applicativa token OAuth.
- [x] Strategia webhook pubblici locali decisa: Shopify CLI tunnel per dev Shopify, Vercel stabile per eBay.

## 5. Product defaults

- [ ] Import iniziale default `draft` confermato.
- [ ] 1 location Shopify predefinita confermata.
- [ ] Tutte le immagini copiate su Shopify confermato.
- [ ] Descrizione pulita con anteprima confermata.
- [ ] Sync entro 5 minuti + real-time sostenibile confermato.
- [ ] Stock buffer e modalita prudente definiti almeno come opzioni.
- [ ] Rollback import definito.

## 6. Cosa non fare ancora

- [ ] Non creare app pubblica Shopify.
- [ ] Non introdurre billing.
- [ ] Non creare deploy production.
- [ ] Non configurare CI complessa.
- [x] Non generare codice runtime prima di aver chiuso le decisioni bloccanti.

## 7. Verifiche scaffold

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm audit --omit=dev`
- [x] `npx prisma validate`
- [x] Installazione Shopify end-to-end sul dev store.
- [ ] Primo deploy/preview Vercel.

## 8. Adattamento scaffold a SyncBay

- [x] Dashboard embedded in italiano con stato Shopify/eBay/sync.
- [x] Modello Prisma iniziale per shop, connessione eBay, job e audit log.
- [x] Flusso OAuth eBay lato app: `/auth/ebay/start` e `/auth/ebay/callback`.
- [x] Placeholder webhook Shopify: prodotti aggiornati e inventory levels aggiornati configurati; ordini pagati implementato lato route ma non ancora sottoscritto nel manifest.
- [x] `.env.example` allineato a dev store, eBay sandbox e callback da completare.
