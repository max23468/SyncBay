import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
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
        <Link to="/app" rel="home">
          {SYNCBAY_APP_NAME}
        </Link>
        <Link to="/app">Panoramica</Link>
        <Link to="/app/catalog">Catalogo</Link>
        <Link to="/app/conflicts">Conflitti</Link>
        <Link to="/app/import-preview">Importazione</Link>
        <Link to="/app/activity">Attività</Link>
        <Link to="/app/settings">Impostazioni</Link>
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
