# ADR 0021 — Idoneità del piano Vercel

## Stato

Accettata — 2026-07-13.

## Decisione

Vercel Hobby è ammesso soltanto per sviluppo e uso privato non commerciale.
Prima di onboarding commerciale, billing o uso per clienti paganti SyncBay deve
passare a un piano Vercel che consenta l'uso commerciale. Il gate
`provider:budget` blocca la combinazione `VERCEL_PLAN=hobby` e
`SYNCBAY_COMMERCIAL_USE=true`; se le env mancano lo stato resta `unknown` e non
può essere presentato come verifica riuscita.

La decisione non attiva billing né cambia piano automaticamente. Web Analytics,
Speed Insights, Functions e build concorrono al budget Vercel e vanno verificati
nel dashboard prima di ogni onboarding.

## Fonte

Termini e limiti correnti vanno sempre verificati nella documentazione ufficiale
Vercel prima dell'uso commerciale: [Pricing](https://vercel.com/pricing) e
[Terms of Service](https://vercel.com/legal/terms).
