import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="SyncBay">
      <s-section heading="Connessioni">
        <s-paragraph>
          La base Shopify e pronta. Il prossimo passo e collegare le
          credenziali runtime e preparare la connessione eBay quando il keyset
          sara disponibile.
        </s-paragraph>
      </s-section>

      <s-section heading="Stato MVP">
        <s-unordered-list>
          <s-list-item>Shopify embedded app configurata.</s-list-item>
          <s-list-item>Sessioni persistite con Prisma.</s-list-item>
          <s-list-item>Sync catalogo non ancora attivo.</s-list-item>
          <s-list-item>OAuth eBay in attesa di keyset/RuName.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Runtime">
        <s-unordered-list>
          <s-list-item>React Router</s-list-item>
          <s-list-item>Vercel</s-list-item>
          <s-list-item>Supabase Postgres</s-list-item>
          <s-list-item>Prisma</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
