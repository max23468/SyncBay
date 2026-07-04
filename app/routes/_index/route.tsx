import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SyncBayBrandPanel } from "../../components/SyncBayBrandPanel";
import { getSyncBayMeta } from "../../lib/syncbay-brand";
import { login } from "../../shopify.server";

export const meta: MetaFunction = () => getSyncBayMeta("Accesso");

export const loader = async ({ url }: LoaderFunctionArgs) => {
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded={false}>
      <s-page heading="SyncBay">
        <s-badge slot="accessory" tone="info">1.0 privata</s-badge>
        <s-section heading="Accesso">
          <s-stack gap="base">
            <SyncBayBrandPanel
              detail="Collega il negozio Shopify a SyncBay 1.0 privata e porta il catalogo eBay.it in un flusso controllato."
            />
        {showForm && (
          <Form method="post" action="/auth/login">
            <s-stack gap="base">
              <s-text-field
                id="shop"
                label="Dominio shop"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
                required
              />
              <s-button type="submit" variant="primary">
              Accedi
              </s-button>
            </s-stack>
          </Form>
        )}
          </s-stack>
        </s-section>

        <s-section heading="Distribuzione privata">
          <s-grid
            gap="base"
            gridTemplateColumns="repeat(3, minmax(0, 1fr))"
          >
            <InfoBox
              body="Import guidato dei listing attivi in Shopify."
              title="Catalogo eBay"
            />
            <InfoBox
              body="Aggiornamento stock e retry prioritari."
              title="Disponibilità protetta"
            />
            <InfoBox
              body="Conflitti, diagnostica e log pensati per il negoziante."
              title="Controllo operativo"
            />
          </s-grid>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

function InfoBox({ body, title }: { body: string; title: string }) {
  return (
    <s-box border="base" borderColor="base" borderRadius="base" padding="base">
      <s-stack gap="small-200">
        <s-heading>{title}</s-heading>
        <s-text color="subdued">{body}</s-text>
      </s-stack>
    </s-box>
  );
}
