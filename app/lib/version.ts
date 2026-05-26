/**
 * Versione corrente di SyncBay.
 *
 * Convenzione SemVer adattata a Shopify app SaaS:
 * - MAJOR: cambiamento non retrocompatibile per negoziante, dati o contratti tecnici.
 * - MINOR: nuova funzionalità retrocompatibile.
 * - PATCH: fix, hardening, copy, UI, runtime o processo operativo compatibile.
 *
 * Per preparare una release:
 * 1. aggiungi le voci sotto `[Non rilasciato]` in `CHANGELOG.md`;
 * 2. esegui `npm run release`;
 * 3. verifica il diff generato;
 * 4. verifica deploy/runtime solo quando la relativa policy SyncBay è attiva.
 *
 * Vedi `docs/guides/versioning-e-release.md` per la procedura completa.
 */
export const APP_VERSION = "0.17.2";
export const BUILD_DATE = "2026-05-26";
