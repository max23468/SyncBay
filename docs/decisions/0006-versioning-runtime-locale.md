# ADR 0006 - Versioning runtime locale

- **Stato**: Accettato
- **Data**: 2026-05-10
- **Decisori**: maintainer, Codex

## Contesto

SyncBay ha ora uno scaffold Shopify CLI React Router, una dashboard embedded, schema Prisma, migration iniziali e una prima base di connessioni Shopify/eBay. La policy precedente teneva il versioning solo teorico perché mancava codice applicativo.

Il maintainer ha chiesto un meccanismo in linea con Pratix: SemVer leggero, changelog disciplinato, single source of truth della versione e comando locale di release.

## Decisione

Adottiamo SemVer convenzionale adattato a Shopify app SaaS.

La versione corrente vive in:

```text
app/lib/version.ts
```

Il comando locale di release è:

```bash
npm run release
```

Sono disponibili anche:

```bash
npm run release:dry-run
npm run release -- --bump patch
npm run release -- --bump minor
npm run release -- --bump major
npm run release -- --bump none
```

Il comando aggiorna `CHANGELOG.md` e `app/lib/version.ts`, ma non crea tag Git, GitHub Release o deploy.

## Regole

- `MAJOR`: cambiamento non retrocompatibile per negoziante, dati o contratti tecnici.
- `MINOR`: nuova funzionalità retrocompatibile.
- `PATCH`: fix, hardening, copy, UI, runtime o processo operativo compatibile.
- `Non versionato`: piani, ADR, guide interne e regole di processo che non cambiano prodotto o supporto a una versione.

`CHANGELOG.md` non deve mescolare voci versionate e `Non versionato` nello stesso blocco da rilasciare.

## Rapporto con pubblicazione

Pubblicare su GitHub/main non significa sempre rilasciare una versione.

Rilasciare una versione non significa automaticamente:

- deploy production;
- tag GitHub;
- GitHub Release;
- pubblicazione Shopify App Store;
- billing;
- attivazione integrazioni produttive.

Quando il deploy production verrà deciso, questa ADR andrà integrata con smoke test e policy di promozione Vercel.

## Conseguenze

- SyncBay ha una versione visibile nella dashboard embedded.
- Le modifiche runtime possono essere classificate e rilasciate senza improvvisare.
- Il flusso resta vicino a Pratix, ma senza introdurre automazioni remote premature.
- Release Please resta non adottato: potrà essere rivalutato solo con decisione esplicita.

## Riferimenti

- `app/lib/version.ts`
- `scripts/release.mjs`
- `CHANGELOG.md`
- `docs/guides/versioning-e-release.md`
