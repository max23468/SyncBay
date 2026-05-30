# ADR 0008 - Tag e GitHub Release

- **Stato**: Accettato
- **Data**: 2026-05-26
- **Decisori**: maintainer, Codex

## Contesto

SyncBay ha versioning runtime locale con `app/lib/version.ts`,
`CHANGELOG.md` e `npm run release`.

Esiste un deployment pilota Vercel production, ma non equivale a una release
pubblica Shopify App Store. Release prodotto, deploy Vercel, pubblicazione App
Store e billing restano azioni distinte.

La decisione aperta "Release production" includeva anche il dubbio su tag e
GitHub Release. Questa ADR chiude solo quel sotto-tema: non decide App Store,
billing, support policy o deploy production pubblico.

## Decisione

Quando SyncBay prepara una release prodotto reale:

- la source of truth della versione resta `app/lib/version.ts`;
- `npm run release` aggiorna `CHANGELOG.md` e `app/lib/version.ts`;
- il tag Git deve avere formato `vX.Y.Z` e corrispondere esattamente a
  `APP_VERSION`;
- la GitHub Release, se creata, parte da quel tag e usa note derivate dalla
  sezione rilasciata di `CHANGELOG.md`;
- il deploy Vercel resta separato e va verificato con la policy attiva;
- pubblicazione Shopify App Store, billing e integrazioni produttive restano
  fuori da questa decisione.

Non creare tag o GitHub Release per `### Non versionato`, piani, ADR, guide,
governance, template o pubblicazioni docs-only.

Release Please non è adottato. Potrà essere rivalutato solo con nuova ADR dopo
un ciclo release operativo stabile.

## Alternative considerate

- Tag/GitHub Release solo dopo App Store: scartato perché una release prodotto
  runtime può servire anche prima dell'app pubblica.
- Tag a ogni merge su `main`: scartato perché non tutte le pubblicazioni sono
  versionate e tag/GitHub Release restano riservati alle release prodotto reali.
- Release Please subito: scartato perché SyncBay usa ancora un comando locale
  intenzionale e non ha un ciclo release automatico maturo.

## Conseguenze

- ADR 0006 resta valida per il versioning locale.
- La decisione aperta "Release production" resta aperta solo per production/App
  Store, supporto, billing e promozione operativa.
- Le modifiche docs-only continuano a non richiedere release SemVer, deploy,
  tag o GitHub Release.

## Riferimenti

- `app/lib/version.ts`
- `scripts/release.mjs`
- `CHANGELOG.md`
- `docs/guides/versioning-e-release.md`
- `docs/decisions/0006-versioning-runtime-locale.md`
