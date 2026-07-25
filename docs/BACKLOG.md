# Backlog - SyncBay

Questo documento raccoglie idee, debiti e attività non ancora promosse nella roadmap operativa. Una voce nel backlog non è scope approvato. La direzione e le prossime mosse stanno in `docs/ROADMAP.md`.

## Regole

- Non usare il backlog come autorizzazione a implementare.
- Promuovi una voce in `docs/ROADMAP.md` solo quando diventa prioritaria o decisa.
- Le decisioni aperte restano in `docs/DECISIONS_PENDING.md` finché non diventano ADR o vengono scartate.
- Non allargare SyncBay a marketplace generico bidirezionale senza decisione esplicita.

## Idee prodotto non ancora scelte

| Voce                                   | Stato       | Nota                                                                                                                                                                                                                 |
| -------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality score import/listing           | Idea        | Da valutare solo se spiega rischi concreti al negoziante senza introdurre metriche opache.                                                                                                                           |
| Comunicazione sconti/prezzi storefront | Idea        | Modulo futuro per comunicare sconti o prezzi promozionali prima del carrello, preferibilmente con theme app extension, app block o app embed. Non è core 1.0 e non autorizza patch dirette a Liquid/CSS/JS dei temi. |
| Multi-marketplace                      | Idea        | Fuori scope finché eBay.it-first non è consolidato.                                                                                                                                                                  |
| Support policy pubblica                | Da definire | Serve prima dell'app pubblica Shopify App Store; default attuale: self-service first.                                                                                                                                |
| Billing                                | Da definire | Fuori dalla custom app privata; necessario prima di una distribuzione pubblica.                                                                                                                                      |

### Comunicazione sconti/prezzi storefront

Contesto: durante il go-live controllato Numisleo su Shopify è emersa una
differenza tra un tema legacy 2.x, che comunicava uno sconto già su prodotto,
collezioni e ricerca tramite logica Liquid del tema, e il tema target Galleria
4, che lascia il prezzo pieno prima del carrello e mostra/applica lo sconto solo
nel carrello o checkout. Per preservare gli auto-update del tema, la decisione
operativa Numisleo è stata di non replicare quella logica con patch custom a
Liquid, CSS o JavaScript del tema.

Possibile evoluzione SyncBay: valutare un modulo storefront per permettere al
negoziante di comunicare in modo coerente sconti o prezzi promozionali prima
del carrello senza modificare direttamente i file core del tema.

Vincoli da rispettare prima di promuoverla:

- distinguere prezzo reale Shopify, `compare-at price`, sconti carrello o
  checkout e messaggi promozionali pre-carrello;
- non inventare prezzi, non simulare sconti non applicati e non creare
  incoerenze legali o commerciali;
- preferire una Shopify theme app extension con app block/app embed o un modulo
  storefront dedicato;
- evitare patch dirette a Liquid, CSS o JavaScript dei temi quando il requisito
  è mantenere gli auto-update;
- valutare impatto su scope Shopify, review App Store, accessi richiesti,
  microcopy e test storefront;
- creare un piano dedicato e, se entra in scope stabile, un ADR prima di
  implementare.

## Debiti tecnici e operativi

| Voce                          | Stato  | Nota                                                                                                                                                                |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rimozione override `ajv`      | Aperta | Issue GitHub #12: rimuovere l'override quando `@vercel/static-config` o `@vercel/react-router` useranno a monte una versione patchata.                              |
| Policy production e App Store | Aperta | Esiste un deployment Vercel production per la distribuzione privata, ma mancano ancora criteri stabili per app pubblica, promozione production e Shopify App Store. |
| Verifica smoke post-deploy    | Aperta | Da rendere gate stabile solo quando criteri production, ambienti e app pubblica saranno decisi.                                                                     |
| Migrazione React Router 8     | Aperta | Unica via per chiudere GHSA-qwww-vcr4-c8h2; SyncBay non è esposta perché non usa le API RSC. Vedi sotto.                                                            |

### Migrazione React Router 8

`npm run audit:prod` segnala `react-router` e `@react-router/node` per
GHSA-qwww-vcr4-c8h2 (CSRF bypass che consente l'esecuzione di una action prima
della risposta 400). Le versioni affette sono `>=7.12.0 <8.3.0` e la correzione
esiste solo in `8.3.0`: la linea 7 si ferma a `7.18.1` e non ha backport, quindi
non c'è aggiornamento possibile dentro la major corrente.

SyncBay non è esposta: l'advisory riguarda esclusivamente le API RSC instabili,
mentre `react-router.config.ts` usa framework mode con `ssr: true` e nessun
riferimento RSC. Le due voci restano quindi visibili nell'audit finché la
migrazione non avviene, senza rischio applicativo reale.

Il blocco non è di volontà ma di peer range: `@vercel/react-router@1.3.1`
dichiara peer `@react-router/dev: "7"` e `@react-router/node: "7"`, e
`@shopify/shopify-app-react-router@1.2.1` dichiara peer `react-router: "^7.6.2"`.
Finché Vercel e Shopify non aggiornano, la major 8 non è installabile senza
rompere il contratto peer di entrambe le integrazioni. Stesso schema di
`docs/BACKLOG.md` per TypeScript 7: si aspetta il monte, non si forza con
`--legacy-peer-deps`.

La migrazione è già parzialmente preparata: i future flag `v8_middleware`,
`v8_passThroughRequests`, `v8_splitRouteModules`,
`v8_trailingSlashAwareDataRequests` e `v8_viteEnvironmentApi` sono attivi. Quando
i peer si apriranno resterà da valutare l'impatto sul preset Vercel e sulle route
embedded: è un major applicativo, non un fix di sicurezza, e merita il suo ADR.

Nel frattempo l'advisory è registrata in `ACCEPTED_ADVISORIES`
(`scripts/syncbay-audit-prod.mjs`) con motivo e condizione di revisione, così
`audit:prod` resta verde e continua a fallire su qualunque vulnerabilità nuova.
La voce va rimossa insieme alla migrazione.

## Decisioni collegate

- Decisioni aperte: `docs/DECISIONS_PENDING.md`
- Policy Git/pubblicazione: `docs/guides/git-e-pubblicazione.md`
- Versioning e release: `docs/guides/versioning-e-release.md`
- Runtime e CI futuri: `docs/decisions/0004-runtime-ci-release-future.md`
