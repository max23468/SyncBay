import type { MetaFunction } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SyncBayBrandPanel } from "../components/SyncBayBrandPanel";
import { getSyncBayMeta } from "../lib/syncbay-brand";

export const meta: MetaFunction = () => getSyncBayMeta("Privacy");

export default function Privacy() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Informativa privacy SyncBay">
        <s-badge slot="accessory" tone="info">
          1.0 privata
        </s-badge>
        <s-section heading="SyncBay">
          <s-stack gap="base">
            <SyncBayBrandPanel detail="I dati trattati servono a collegare eBay.it a Shopify, allineare il catalogo e mostrare diagnostica operativa." />
            <s-text>
              SyncBay 1.0 è una custom app privata per clienti selezionati. Non è ancora pubblicata
              nello Shopify App Store e non è una soluzione ufficiale eBay o Shopify. L&apos;app
              collega un negozio Shopify a un account eBay.it per importare, collegare e
              sincronizzare dati di catalogo, disponibilità e informazioni operative necessarie al
              servizio.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Quali dati tratta">
          <s-stack gap="base">
            <s-text>
              L&apos;app può trattare dati tecnici dello shop Shopify, dati account e catalogo eBay,
              dati catalogo Shopify, immagini, SKU, prezzi, quantità, stato prodotto, canali di
              pubblicazione e impostazioni operative dello shop.
            </s-text>
            <s-unordered-list>
              <s-list-item>dati shop Shopify e dati account eBay collegati;</s-list-item>
              <s-list-item>
                dati catalogo eBay e Shopify necessari a import, takeover e sync;
              </s-list-item>
              <s-list-item>
                token eBay trattati lato server e cifrati a riposo quando persistiti da SyncBay;
              </s-list-item>
              <s-list-item>
                log, job, audit, mapping, snapshot prodotto e conflitti Shopify;
              </s-list-item>
              <s-list-item>
                ordini Shopify pagati limitati ai dati necessari per aggiornare la disponibilità su
                eBay.
              </s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-section>

        <s-section heading="Come vengono usati">
          <s-text>
            I dati sono usati solo per fornire il servizio SyncBay, mantenere allineato il catalogo,
            ridurre il rischio di vendere prodotti non disponibili, mostrare diagnostica, aprire
            conflitti quando Shopify diverge dall&apos;ultimo valore scritto da SyncBay e gestire
            errori, revoche, disinstallazioni e richieste provider come eBay marketplace account
            deletion.
          </s-text>
        </s-section>

        <s-section heading="Sicurezza">
          <s-stack gap="base">
            <s-text>
              Token e segreti non vengono salvati nel repository. I token eBay persistiti da SyncBay
              sono trattati lato server e cifrati a riposo dal runtime applicativo. Le sessioni
              Shopify restano nel database server-side della custom app e sono accessibili solo al
              runtime.
            </s-text>
            <s-text>
              Le tabelle operative con token, job, audit, mapping e dati shop restano server-side
              nel perimetro 1.0 privata. SyncBay non espone questi dati a client pubblici senza
              policy esplicite.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Conservazione">
          <s-text>
            La retention operativa segue le decisioni tecniche ADR 0017 e ADR 0018: job, audit,
            snapshot, stati OAuth temporanei e notifiche account deletion hanno finestre diverse in
            base allo scopo operativo e di compliance. Queste finestre verranno rivalutate prima di
            una futura pubblicazione App Store.
          </s-text>
        </s-section>

        <s-section heading="Contatto">
          <s-stack gap="base">
            <s-text>
              Per richieste privacy, revoca, disinstallazione o rimozione dati nella 1.0 privata,
              contattare il maintainer del progetto SyncBay.
            </s-text>
            <s-text color="subdued">Ultimo aggiornamento: 1 luglio 2026.</s-text>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
