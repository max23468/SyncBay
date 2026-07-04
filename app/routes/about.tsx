import type { MetaFunction } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SyncBayBrandPanel } from "../components/SyncBayBrandPanel";
import { getSyncBayMeta } from "../lib/syncbay-brand";

export const meta: MetaFunction = () => getSyncBayMeta("Informazioni");

export default function About() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Informazioni su SyncBay">
        <s-badge slot="accessory" tone="info">1.0 privata</s-badge>
        <s-section heading="SyncBay">
          <s-stack gap="base">
            <SyncBayBrandPanel
              detail="SyncBay nasce per negozianti italiani che vogliono trasformare un negozio eBay.it in un catalogo Shopify ordinato."
            />
            <s-text>
              SyncBay è una Shopify app in distribuzione privata pensata per
              collegare un account eBay.it a Shopify e mantenere il catalogo
              Shopify allineato ai listing eBay.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Cosa fa">
          <s-text>
            L&apos;app importa e sincronizza prodotti, immagini, descrizioni,
            prezzi e disponibilità partendo da eBay, che resta la sorgente
            principale del catalogo.
          </s-text>
        </s-section>

        <s-section heading="Per chi è pensata">
          <s-text>
            SyncBay è pensata per negozianti italiani che hanno già un catalogo
            su eBay.it e vogliono portarlo su Shopify con un flusso controllato,
            diagnostica chiara e gestione esplicita dei conflitti.
          </s-text>
        </s-section>

        <s-section heading="Stato del servizio">
          <s-stack gap="base">
            <s-text>
              Il servizio è disponibile come 1.0 privata per clienti
              selezionati. Non è ancora pubblicato nello Shopify App Store e non
              è una soluzione ufficiale eBay o Shopify.
            </s-text>
            <s-text color="subdued">
              Ultimo aggiornamento: 4 luglio 2026.
            </s-text>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
