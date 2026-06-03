# ADR 0009 - Token offline Shopify a scadenza

- **Stato**: Accettato
- **Data**: 2026-06-03
- **Decisori**: maintainer, Codex

## Contesto

SyncBay esegue job automatici che chiamano Shopify Admin API senza interazione
utente: import, sync incrementale, archiviazione prodotti e gestione conflitti.
Questi job richiedono una sessione Shopify offline valida.

Shopify supporta token offline a scadenza con refresh token da dicembre 2025.
Dal 1 gennaio 2027 tutte le public app che chiamano Admin API devono usare token
offline a scadenza; le app che usano token offline non a scadenza riceveranno
errori di autenticazione. La documentazione Shopify indica anche che i token a
scadenza vanno richiesti con `expiring=1`, persistendo `expires`,
`refreshToken` e `refreshTokenExpires`, e refreshati prima dell'uso nei job
senza interazione utente.

SyncBay oggi è un pilota custom, ma la direzione confermata resta una futura
public app Shopify. Allinearsi subito evita di costruire affidabilità su una
modalità legacy che andrebbe rimossa prima della pubblicazione.

## Decisione

SyncBay usa token offline Shopify a scadenza come requisito operativo per i job
automatici e non considera più sane le sessioni offline legacy senza `expires`.

In pratica:

- `future.expiringOfflineAccessTokens` resta attivo nella configurazione
  Shopify React Router;
- il runner automatico usa la sessione offline salvata, controlla `expires` e
  aggiorna il token con `refreshToken` prima delle chiamate Admin GraphQL;
- una sessione offline senza `expires` viene trattata come legacy da migrare,
  non come token valido a tempo indefinito;
- se mancano `refreshToken` o credenziali app, il runner deve fermarsi con un
  errore operativo che chiede di riaprire l'app Shopify e ripetere il flusso di
  autorizzazione/migrazione;
- non si introducono token Shopify a durata illimitata come workaround per i
  job automatici.

## Conseguenze

- SyncBay resta compatibile con il requisito Shopify 2027 per il percorso public
  app.
- I job automatici esercitano il percorso reale di refresh invece di aggirarlo.
- Un leak di access token Shopify ha una finestra di impatto più corta rispetto
  a un token senza scadenza.
- Il refresh token resta una credenziale sensibile: va custodito nello storage
  sessioni server-side, mai stampato nei log e mai salvato nel repository.
- Se il refresh token scade, l'azione corretta è far riaprire l'app al
  negoziante per ottenere una nuova coppia token, non forzare un token legacy.
- Il pilota custom può continuare a funzionare, ma il suo comportamento deve
  restare rappresentativo della futura app pubblica.

## Alternative considerate

- **Continuare con token offline non a scadenza nel pilota**: scartata perché
  nasconde difetti nel refresh path e prepara un sistema non conforme alla
  futura public app.
- **Usare token a durata molto lunga come fallback operativo**: scartata perché
  peggiora sicurezza, diagnosi e compliance; in caso di leak il token resta
  valido finché non viene revocato.
- **Aspettare il 2027 per migrare**: scartata perché SyncBay dipende da job
  automatici e il percorso di refresh va provato durante il pilota, non alla
  soglia della pubblicazione.

## Riferimenti

- Shopify changelog: <https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-all-public-apps-as-of-january-1-2027>
- Shopify docs: <https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens>
