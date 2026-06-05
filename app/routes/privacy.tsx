import type { MetaFunction } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SyncBayBrandPanel } from "../components/SyncBayBrandPanel";
import { getSyncBayMeta } from "../lib/syncbay-brand";

export const meta: MetaFunction = () => getSyncBayMeta("Privacy");

export default function Privacy() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Informativa privacy provvisoria">
        <s-badge slot="accessory" tone="info">Pilota controllato</s-badge>
        <s-section heading="SyncBay">
          <s-stack gap="base">
            <SyncBayBrandPanel
              detail="I dati trattati servono a importare catalogo, disponibilità e diagnostica del servizio SyncBay."
            />
            <s-text>
              SyncBay è una Shopify app in fase pilota che collega un negozio
              Shopify a un account eBay per importare e sincronizzare dati di
              catalogo, disponibilità e informazioni operative necessarie al
              servizio.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Quali dati tratta">
          <s-text>
            L&apos;app può trattare dati tecnici dello shop Shopify, dati del
            catalogo eBay, token di accesso dei provider, log operativi, audit
            log, stato delle connessioni e informazioni necessarie a import,
            sync, retry e diagnostica.
          </s-text>
        </s-section>

        <s-section heading="Come vengono usati">
          <s-text>
            I dati sono usati solo per fornire il servizio SyncBay, mantenere
            allineato il catalogo, ridurre il rischio di vendere prodotti non
            disponibili, mostrare diagnostica e gestire errori, revoche e
            disinstallazioni.
          </s-text>
        </s-section>

        <s-section heading="Sicurezza">
          <s-text>
            I token e i segreti non devono essere salvati nel repository. I
            token eBay persistiti da SyncBay sono trattati lato server e cifrati
            a riposo nel runtime applicativo.
          </s-text>
        </s-section>

        <s-section heading="Contatto">
          <s-stack gap="base">
            <s-text>
              Per richieste privacy, revoca o rimozione dati durante il pilota,
              contattare il maintainer del progetto SyncBay.
            </s-text>
            <s-text color="subdued">
              Ultimo aggiornamento: 10 maggio 2026.
            </s-text>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
