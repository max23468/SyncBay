# ADR 0021 — Idoneità del piano Vercel

## Stato

Accettata — 2026-07-13.

## Decisione

Vercel Hobby è ammesso soltanto per sviluppo e uso privato non commerciale.
Prima di onboarding commerciale, billing o uso per clienti paganti SyncBay deve
passare a un piano Vercel che consenta l'uso commerciale. Il gate
`provider:budget` osserva prima il piano reale del team tramite Vercel CLI/API;
`VERCEL_PLAN` resta un fallback dichiarativo e un controllo di drift. La
combinazione piano osservato Hobby e `SYNCBAY_COMMERCIAL_USE=true` è bloccata.
Se l'uso commerciale non è dichiarato, il report non restituisce uno stato
ambiguo: usa la baseline privata corrente `ok_private_only` e richiede la
dichiarazione esplicita prima dell'onboarding.

La decisione non attiva billing né cambia piano automaticamente. Web Analytics
viene osservato via CLI sulla finestra mobile di 30 giorni del team. Speed
Insights è una lettura parziale di 7 giorni sul piano Hobby; Fast Data Transfer
e metriche Functions restano `provider_locked` senza Observability Plus. Gli
stati parziali o bloccati dal provider richiedono ancora il dashboard prima di
ogni onboarding.

## Fonte

Termini e limiti correnti vanno sempre verificati nella documentazione ufficiale
Vercel prima dell'uso commerciale: [Pricing](https://vercel.com/pricing) e
[Terms of Service](https://vercel.com/legal/terms).
