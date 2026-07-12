# SyncBay

SyncBay porta un catalogo eBay.it in Shopify e lo mantiene allineato, con eBay
come sorgente di verità e Shopify come copia ordinata e vendibile.

## Stato

Custom app privata 1.0 su Shopify CLI + React Router, con produzione tecnica
Vercel e runtime Supabase. Import, sincronizzazione incrementale, conflitti,
diagnostica e aggiornamento disponibilità eBay da ordini Shopify sono
implementati. Billing e pubblicazione Shopify App Store restano fuori scope.

Lo stato operativo corrente e i rischi aperti sono in
[`docs/CONTEXT.md`](docs/CONTEXT.md); priorità e seguito stanno in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Vincoli prodotto

- Flusso catalogo: eBay -> Shopify.
- Unica scrittura Shopify -> eBay: disponibilità derivata da ordini pagati.
- Marketplace iniziale: eBay.it.
- Target sync: 5–30 minuti.
- Limite 1.0: 2.000 prodotti per shop.
- Listing eBay inattivi: prodotti Shopify esauriti, non cancellati o archiviati.
- Modifiche manuali Shopify: conflitti visibili, non overwrite silenziosi.

## Avvio locale

```bash
npm install
npm run dev
```

Comandi, versioni e gate: [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md).

## Documentazione

- [Indice canonico](docs/INDEX.md)
- [Contesto rapido](docs/CONTEXT.md)
- [Piano prodotto e tecnico](docs/syncbay-product-technical-plan.md)
- [Decisioni architetturali](docs/DECISIONS.md)
- [Toolchain e verifiche](docs/TOOLCHAIN.md)
- [Sicurezza](SECURITY.md)
- [Brand](BRAND.md)

Le regole operative per agenti e collaboratori sono in [AGENTS.md](AGENTS.md).
