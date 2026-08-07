# ADR 0012 - Impostazioni avanzate: disconnessione eBay e intervallo sync configurabile

- **Stato**: Accettato
- **Data**: 2026-06-12
- **Decisori**: maintainer, Claude

Nota 2026-06-23: la parte sull'intervallo target è aggiornata da ADR 0021,
che porta le opzioni correnti a 5-30 minuti per ridurre l'egress del pilota.

## Contesto

Le Impostazioni esponevano lo stato del collegamento eBay e l'intervallo target
solo in lettura, e l'attivazione/disattivazione del sync senza conferma. Il
maintainer ha chiesto di completare le Impostazioni come pagina self-service,
attivando quattro capacità prima assenti:

1. **Scollega eBay** dal negoziante, senza dover passare dal supporto o dalla
   disinstallazione dell'app.
2. **Intervallo target configurabile**, oggi fisso a 300 secondi.
3. **Conferma esplicita** prima di disattivare il sync.
4. **Ultimo aggiornamento** visibile tra i dati del sync.

Le prime due toccano auth/token e comportamento del sync, quindi richiedono una
decisione documentata.

## Decisione

### Disconnessione eBay self-service

Si introduce un'azione `disconnectEbayConnection` richiamabile dalle
Impostazioni (box Avanzate), dietro conferma esplicita. La disconnessione:

- azzera i token cifrati locali (`encryptedAccessToken`,
  `encryptedRefreshToken`) e i campi correlati (`tokenExpiresAt`,
  `refreshTokenExpiresAt`, `scopes`, `connectedAt`, `ebayUserId`,
  `lastRefreshAt`);
- imposta lo stato connessione a `NOT_CONNECTED`;
- disattiva il sync automatico (`syncEnabled = false`);
- registra un `AuditLog` di tipo `EBAY_DISCONNECTED`.

È **reversibile**: il catalogo già importato (mapping, snapshot, prodotti
Shopify) **non** viene toccato, distinguendola dalla cancellazione dati per
_eBay marketplace account deletion_ (compliance), che resta separata. Il
negoziante può ricollegare eBay e riprendere gli aggiornamenti.

La revoca lato eBay del refresh token via API non è inclusa in questa fase:
l'azione di sicurezza rilevante è l'azzeramento dei token cifrati a riposo, che
rende SyncBay incapace di usarli. La revoca server-side resta un miglioramento
futuro.

### Intervallo sync configurabile

Si introduce `updateSyncTargetSeconds`, che permette al negoziante di scegliere
l'intervallo target tra valori discreti: **120, 180, 300 secondi** (2, 3,
5 minuti). Il valore guida la cadenza del sync incrementale
(`getNextIncrementalEnqueueAt`) e la soglia "in ritardo"
(`syncbay-sync-health`).

Vincoli: resta valido il target "entro massimo 5 minuti" (300 s come tetto) e il
floor operativo di 120 s introdotto con ADR 0019 per allineare la cadenza del
runner Supabase Cron. Valori fuori dall'insieme sono rifiutati lato server
(`normalizeSyncTargetSeconds`). Intervalli più rapidi aumentano carico e rate
limit: la scelta resta del negoziante entro i limiti.

### Conferma disattivazione e ultimo aggiornamento

Cambi solo di presentazione/dati, senza nuova decisione architetturale:

- la disattivazione del sync passa per un disclosure di conferma nativo con nota
  sulle conseguenze;
- `getShopSettingsState` espone `lastIncrementalFinishedAt`, mostrato come tile
  "Ultimo aggiornamento".

## Alternative considerate

- **Non offrire la disconnessione**: scartato, lasciava il negoziante dipendente
  dal supporto o dalla disinstallazione.
- **Cancellare anche il catalogo alla disconnessione**: scartato, sovrappone la
  disconnessione volontaria alla cancellazione dati GDPR; la disconnessione deve
  restare reversibile.
- **Intervallo a campo numerico libero**: scartato a favore di opzioni discrete
  validabili, più sicure e chiare.
- **Intervallo oltre 5 minuti**: scartato, romperebbe il target di prodotto.

## Conseguenze

- Nuove azioni server con `AuditLog` dedicato; verifica in corsia completa
  (auth/dati) con test unitari sulla validazione intervallo.
- `EBAY_DISCONNECTED` (già presente nell'enum) viene finalmente usato.
- La UI Impostazioni resta nei quattro box verticali e nel design layer
  (ADR 0010), senza nuovi runtime o provider.
- Resta invariato il perimetro: nessun export Shopify→eBay, nessuna integrazione
  oltre OAuth.

## Riferimenti

- `docs/decisions/0010-ui-design-layer-e-marchi-terzi.md`
- `app/lib/syncbay-sync-interval.ts`
- `app/services/syncbay-operations.server.ts` (`disconnectEbayConnection`)
- `app/services/syncbay-product-updates.server.ts` (`updateSyncTargetSeconds`)
- `app/services/syncbay-state.server.ts` (`getShopSettingsState`)
- `app/services/ebay-account-deletion.server.ts` (flusso compliance distinto)
