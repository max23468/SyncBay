# Checklist pre-scaffold

Questa checklist va chiusa prima di generare codice applicativo, `package.json`, Shopify CLI app o cartelle runtime.

## 1. Repo e documentazione

- [ ] Primo commit docs di fondazione creato.
- [ ] Remote GitHub deciso e configurato.
- [ ] Branch policy confermata.
- [ ] `AGENTS.md` riletto e coerente con lo stato reale.
- [ ] `docs/decisions-pending.md` aggiornato.
- [ ] Decisioni bloccanti spostate in ADR quando chiuse.

## 2. Account Shopify

- [ ] Account Shopify Partner disponibile.
- [ ] Development store disponibile.
- [ ] Nome app custom confermato.
- [ ] App URL provvisorio deciso.
- [ ] Redirect URL locali/provvisori decisi.
- [ ] Scopes Shopify iniziali confermati.
- [ ] Webhook minimi confermati: uninstall, orders, products, inventory.

## 3. Account eBay

- [ ] Account eBay Developer disponibile.
- [ ] App eBay creata o pronta da creare.
- [ ] Marketplace iniziale confermato: `EBAY_IT`.
- [ ] OAuth redirect URI deciso.
- [ ] Scope eBay necessari verificati su documentazione corrente.
- [ ] Strategia Trading API + Inventory API confermata.
- [ ] Marketplace account deletion notification/opt-out verificato.

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

