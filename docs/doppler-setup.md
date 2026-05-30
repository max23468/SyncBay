# Integrazione Doppler

## Obiettivo
Questo progetto è pronto per l'iniezione dei segreti da Doppler in CI/ambiente runtime.

## Configurazione GitHub richiesta
1. Crea in Doppler un Project con nome uguale al valore in `DOPPLER_PROJECT`.
2. Crea in quel project la Config da usare in CI (consigliata: `production`) e assegna i segreti nel modo abituale.
3. Crea un Service Token **read-only** per GitHub Actions (`token type: service token`), scope al config corretto.
4. Configura questi segreti/variabili nel repository:
   - Secret: `DOPPLER_TOKEN`
   - Variable: `DOPPLER_PROJECT`
   - Variable: `DOPPLER_CONFIG`

## Stato attuale repo
- `DOPPLER_PROJECT` impostato a: `SyncBay`
- `DOPPLER_CONFIG` impostato a: `production`

## Workflow pronto
È stato aggiunto `.github/workflows/doppler-check.yml`.

### Come usarlo
- Apri la pagina *Actions* della repo e lancia manualmente `doppler-check`.
- Se `DOPPLER_TOKEN`, `DOPPLER_PROJECT` e `DOPPLER_CONFIG` sono corretti, il workflow prova il fetch dei segreti Doppler.

## Comandi GitHub (facoltativi)

```bash
gh variable set DOPPLER_PROJECT --body "SyncBay" --repo max23468/SyncBay
gh variable set DOPPLER_CONFIG --body "production" --repo max23468/SyncBay

gh secret set DOPPLER_TOKEN --body "<service_token_read_only>" --repo max23468/SyncBay
```

Sostituisci `<service_token_read_only>` con il token reale del Service Token Doppler.
