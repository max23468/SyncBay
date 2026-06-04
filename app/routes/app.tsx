import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { NavMenu, TitleBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SYNCBAY_APP_NAME } from "../lib/syncbay-brand";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <TitleBar title={SYNCBAY_APP_NAME} />
      <NavMenu>
        <a href="/app" rel="home">
          {SYNCBAY_APP_NAME}
        </a>
        <a href="/app">Panoramica</a>
        <a href="/app/catalog">Catalogo</a>
        <a href="/app/conflicts">Conflitti</a>
        <a href="/app/import-preview">Importazione</a>
        <a href="/app/activity">Attività</a>
        <a href="/app/settings">Impostazioni</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
