# Hardening tecnico-operativo (2026-05-27)

## Rischio iniziale

- Livello: **medio-alto**.
- Stato in questa ondata: **P0/P1 con priorità alla separazione segreti**.
- Rotazione segreti: **non inclusa** in questa fase (espressamente esclusa).

## Contesto operativo rilevante

- Integrazioni Shopify/eBay e job di sincronizzazione con possibili side-effect commerciali.
- Il punto più sensibile è la gestione della chain di credenziali e callback.

## Piano tecnico (P0/P1/P2)

### P0

- Confermare separazione keyset credenziali e uso di secret store dedicato.
- Verificare che app bot/non pubbliche non riusino token in modo improprio (principio di isolamento).
- Proteggere webhook e callback:
  - validazione firma/HMAC;
  - controllo state/sessione; nessun fallback permissivo.
- Mantenere token eBay/Shopify separati per ambiente e ruolo.
- Documentare separazione keyset e ruoli in runbook operativo.

### P1

- Threat-scan su callback endpoints, flussi OAuth e API interne:
  - controllo CSRF/state su callback;
  - definizione policy retry.
- Aggiungere rate limit sulle API interne e soglie per evitare loop.
- Verificare che i job di import non possano espandere scope senza controllo manuale.
- Prevedere verifiche manuali sandbox per ogni modifica credenziali critica.

### P2

- Runbook di incidenti per gestione token/app store/billing fuori da git.
- Verifica periodica di integrità flussi import/ordine e alert su stati anomali.

## Piano operativo e di governo

### P0/P1

- Per modifiche a credenziali, richiedere checklist esplicita e verifica sandbox/manuale.
- Inserire nota esplicita su quota Actions/limiti esterni nel changelog operativo per evitare escalation non previste.

### P2

- Aggiornare `docs/ROADMAP.md` con una voce dedicata su “governance credenziali + incidenti”.
- Riesaminare trimestralmente piani di approvazione App Store e impatti legali prima di nuove release.
