import type { MetaFunction } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SyncBayBrandPanel } from "../components/SyncBayBrandPanel";
import { getSyncBayMeta } from "../lib/syncbay-brand";

export const meta: MetaFunction = () => getSyncBayMeta("Termini");

export default function Terms() {
  return (
    <AppProvider embedded={false}>
      <s-page heading="Termini SyncBay">
        <s-badge slot="accessory" tone="info">
          1.0 privata
        </s-badge>
        <s-section heading="Servizio">
          <s-stack gap="base">
            <SyncBayBrandPanel detail="SyncBay 1.0 privata collega eBay.it a Shopify per clienti selezionati, con preview e controlli prima delle scritture operative." />
            <s-text>
              SyncBay 1.0 privata è fornita a clienti selezionati per collegare eBay.it a Shopify.
              eBay resta la sorgente di verità del catalogo; Shopify viene riallineato secondo
              impostazioni, preview e conferme operative.
            </s-text>
            <s-text>
              Il servizio non è ancora pubblicato nello Shopify App Store, non include billing
              pubblico e non è una soluzione ufficiale eBay o Shopify.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Responsabilità del negoziante">
          <s-unordered-list>
            <s-list-item>
              Verificare che l&apos;account eBay collegato sia quello corretto.
            </s-list-item>
            <s-list-item>
              Controllare preview, eccezioni e conflitti prima di confermare scritture sul catalogo.
            </s-list-item>
            <s-list-item>
              Non modificare manualmente eBay o Shopify durante una finestra di freeze concordata.
            </s-list-item>
            <s-list-item>
              Verificare il catalogo dopo apply, soprattutto prezzo, disponibilità, immagini e URL
              prodotto.
            </s-list-item>
          </s-unordered-list>
        </s-section>

        <s-section heading="Fonte di verità eBay">
          <s-text>
            Nel perimetro 1.0, eBay.it è la sorgente principale del catalogo. SyncBay può aggiornare
            Shopify con dati eBay presenti e validi. Se un dato eBay è assente, vuoto, non leggibile
            o non affidabile, SyncBay deve segnalarlo come eccezione invece di cancellare dati
            Shopify validi.
          </s-text>
        </s-section>

        <s-section heading="Limiti 1.0 privata">
          <s-unordered-list>
            <s-list-item>Marketplace iniziale: eBay.it.</s-list-item>
            <s-list-item>Limite operativo 1.0: fino a 2.000 listing attivi per shop.</s-list-item>
            <s-list-item>
              Target: cataloghi con prodotti singoli e senza varianti complesse.
            </s-list-item>
            <s-list-item>Una location Shopify predefinita.</s-list-item>
            <s-list-item>
              Nessun App Store pubblico, billing pubblico o support policy pubblica nella 1.0.
            </s-list-item>
            <s-list-item>
              Nessun rollback self-service prodotto-per-prodotto: recovery manuale tramite snapshot,
              report e strumenti interni.
            </s-list-item>
          </s-unordered-list>
        </s-section>

        <s-section heading="Errori, conflitti e verifica">
          <s-text>
            SyncBay non deve sovrascrivere silenziosamente modifiche manuali Shopify. Divergenze su
            mapping, prezzo, disponibilità, descrizioni, immagini, categorie o tag possono generare
            conflitti o eccezioni da rivedere. Il go-live di un takeover resta bloccato da conflitti
            critici aperti su mapping, prezzo o disponibilità.
          </s-text>
        </s-section>

        <s-section heading="Sospensione o disinstallazione">
          <s-text>
            Il maintainer o il negoziante possono sospendere il sync automatico, disattivare la
            vecchia app di sync secondo il runbook concordato o disinstallare SyncBay. In caso di
            disinstallazione o richiesta di revoca, SyncBay gestisce dati e token secondo la privacy
            policy e le decisioni tecniche di retention.
          </s-text>
        </s-section>

        <s-section heading="Contatto">
          <s-stack gap="base">
            <s-text>
              Per richieste operative, sicurezza, privacy o sospensione del servizio nella 1.0
              privata, contattare il maintainer del progetto SyncBay.
            </s-text>
            <s-text color="subdued">Ultimo aggiornamento: 1 luglio 2026.</s-text>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
