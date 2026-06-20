import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
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
  const navigation = useNavigation();
  const isRoutePending =
    navigation.state === "loading" &&
    navigation.location?.pathname.startsWith("/app") === true;
  const pendingLabel = getRoutePendingLabel(
    navigation.location?.pathname,
  );

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
      <RoutePendingIndicator isVisible={isRoutePending} label={pendingLabel} />
      <div aria-busy={isRoutePending}>
        <Outlet />
      </div>
    </AppProvider>
  );
}

function RoutePendingIndicator({
  isVisible,
  label,
}: {
  isVisible: boolean;
  label: string;
}) {
  if (!isVisible) return null;

  return (
    <div
      aria-live="polite"
      className="syncbay-route-pending"
      role="status"
    >
      <span aria-hidden="true" className="syncbay-route-pending__dot" />
      <span>{label}</span>
    </div>
  );
}

function getRoutePendingLabel(pathname: string | undefined) {
  if (!pathname) return "Aggiorno sezione...";

  if (pathname.startsWith("/app/catalog")) return "Carico Catalogo...";
  if (pathname.startsWith("/app/conflicts")) return "Carico Conflitti...";
  if (pathname.startsWith("/app/import-preview")) {
    return "Carico Importazione...";
  }
  if (pathname.startsWith("/app/activity")) return "Carico Attività...";
  if (pathname.startsWith("/app/settings")) return "Carico Impostazioni...";

  return "Carico Panoramica...";
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
