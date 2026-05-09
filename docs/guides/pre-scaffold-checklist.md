# Checklist pre-scaffold

Questa checklist va chiusa prima di generare codice applicativo, `package.json`, Shopify CLI app o cartelle runtime.

## 1. Repo e documentazione

- [x] Primo commit docs di fondazione creato.
- [x] Remote GitHub deciso e configurato: https://github.com/max23468/SyncBay
- [x] Branch policy provvisoria documentata.
- [x] `AGENTS.md` riletto e coerente con lo stato reale.
- [x] `docs/decisions-pending.md` aggiornato.
- [ ] Decisioni bloccanti spostate in ADR quando chiuse.

## 2. Account Shopify

- [ ] Account Shopify Partner disponibile.
- [ ] Development store disponibile.
- [ ] Nome app custom confermato.
- [ ] App URL provvisorio deciso.
- [ ] Redirect URL locali/provvisori decisi.
- [x] Scopes Shopify iniziali definiti come bozza MVP.
- [x] Webhook minimi definiti come bozza MVP: uninstall, orders, products, inventory.

## 3. Account eBay

- [ ] Account eBay Developer disponibile.
- [ ] App eBay creata o pronta da creare.
- [x] Marketplace iniziale confermato: `EBAY_IT`.
- [ ] OAuth RuName e accept/reject URL decisi.
- [x] Scope eBay necessari definiti come bozza MVP e verificati su documentazione corrente.
- [x] Strategia Trading API + Inventory API confermata.
- [x] Marketplace account deletion notification/opt-out verificato come requisito.

## 4. Decisioni tecniche bloccanti

- [ ] Hosting scelto o fallback locale chiaro.
- [ ] Database scelto.
- [ ] ORM scelto.
- [ ] Job queue scelta.
- [ ] Storage temporaneo immagini deciso.
- [ ] Strategia segreti/cifratura decisa.
- [ ] Strategia webhook pubblici locali decisa.

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
- [ ] Non generare codice runtime prima di aver chiuso le decisioni bloccanti.
