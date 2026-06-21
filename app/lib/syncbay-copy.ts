/**
 * Dizionario microcopy statico di SyncBay.
 *
 * Casa unica delle stringhe d'interfaccia ricorrenti o condivise tra più
 * superfici, così da de-gergare in un solo posto, evitare divergenze (già viste
 * tra Panoramica e Attività) e restare pronti a una traduzione futura: qui vive
 * solo testo, niente icone, colori o href di presentazione, che restano nei
 * componenti.
 *
 * Le etichette che dipendono da uno stato calcolato (job, conflitti, prossima
 * azione) restano nei helper di `syncbay-ui-state.ts`: questo modulo non le
 * duplica, le affianca per il copy statico. Il modulo è puro (nessun import) per
 * poter essere riusato anche dai helper senza creare cicli.
 */

export const SYNCBAY_COPY = {
  /** Stati vuoti "nessun risultato" condivisi dal componente EmptyState. */
  emptyState: {
    catalogSearch: (query: string) => ({
      title: `Nessun prodotto per «${query}»`,
      body: "Controlla il testo o cerca per titolo, SKU o ItemID eBay.",
      actionLabel: "Azzera la ricerca",
    }),
    catalogUnlinked: {
      title: "Nessun prodotto collegato",
      body:
        "Completa l'importazione iniziale per creare i collegamenti tra " +
        "inserzioni eBay e prodotti Shopify.",
      actionLabel: "Apri importazione",
    },
    catalogFilter: {
      title: "Nessun risultato per questo filtro",
      body: "Prova con il filtro Tutti o torna alla Panoramica.",
      actionLabel: "Mostra tutti",
    },
    conflictsOpen: {
      title: "Nessun conflitto aperto",
      body: "Le modifiche Shopify non richiedono decisioni in questo momento.",
      actionLabel: "Apri catalogo",
    },
    conflictsFilter: {
      title: "Nessun conflitto in questa vista",
      body: "Prova con il filtro Tutti o torna ai conflitti aperti.",
      actionLabel: "Mostra aperti",
    },
    activityFilter: {
      title: "Nessuna attività per questo filtro",
      body:
        "Torna a Tutte oppure avvia l'importazione quando eBay e Shopify sono " +
        "pronti.",
      actionLabel: "Mostra tutte",
    },
  },
} as const;
