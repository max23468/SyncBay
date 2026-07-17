import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useRef } from "react";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { RouteSkeleton } from "../components/SyncBayUi";
import { SYNCBAY_APP_NAME } from "../lib/syncbay-brand";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const routeContentRef = useRef<HTMLElement>(null);
  const hadPendingNavigationRef = useRef(false);
  // Solo navigazioni GET: durante submit e redirect post-action
  // `navigation.formMethod` resta valorizzato, e sostituire la pagina con lo
  // scheletro cancellerebbe gli stati "Salvataggio..." delle route.
  const isRoutePending =
    navigation.state === "loading" &&
    navigation.formMethod == null &&
    navigation.location?.pathname.startsWith("/app") === true;
  const pendingCopy = getRoutePendingCopy(navigation.location?.pathname);

  useEffect(() => {
    if (isRoutePending) {
      hadPendingNavigationRef.current = true;
      return;
    }
    if (!hadPendingNavigationRef.current) return;

    hadPendingNavigationRef.current = false;
    routeContentRef.current?.focus({ preventScroll: true });
  }, [isRoutePending]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-title-bar title={SYNCBAY_APP_NAME} />
      <ui-nav-menu>
        <Link to="/app" rel="home">
          {SYNCBAY_APP_NAME}
        </Link>
        <Link to="/app">Panoramica</Link>
        <Link to="/app/catalog">Catalogo</Link>
        <Link to="/app/conflicts">Conflitti</Link>
        <Link to="/app/import-preview">Importazione</Link>
        <Link to="/app/activity">Attività</Link>
        <Link to="/app/settings">Impostazioni</Link>
      </ui-nav-menu>
      <RoutePendingIndicator copy={pendingCopy} isVisible={isRoutePending} />
      <main
        aria-busy={isRoutePending}
        className="syncbay-route-content"
        data-syncbay-route-content
        ref={routeContentRef}
        tabIndex={-1}
      >
        {isRoutePending ? <RouteSkeleton /> : <Outlet />}
      </main>
    </AppProvider>
  );
}

function RoutePendingIndicator({
  copy,
  isVisible,
}: {
  copy: RoutePendingCopy;
  isVisible: boolean;
}) {
  if (!isVisible) return null;

  return (
    <output
      aria-live="polite"
      aria-label={`${copy.title}. ${copy.detail}`}
      className="syncbay-route-pending"
    >
      <span className="syncbay-route-pending__surface">
        <span aria-hidden="true" className="syncbay-route-pending__icon">
          <s-icon type="refresh" tone="info" size="base" />
        </span>
        <span className="syncbay-route-pending__body">
          <s-text type="strong">{copy.title}</s-text>
          <s-text color="subdued">{copy.detail}</s-text>
        </span>
      </span>
    </output>
  );
}

type RoutePendingCopy = {
  detail: string;
  title: string;
};

function getRoutePendingCopy(pathname: string | undefined): RoutePendingCopy {
  if (!pathname) {
    return {
      detail: "Preparo la prossima vista.",
      title: "Aggiorno sezione",
    };
  }

  if (pathname.startsWith("/app/catalog")) {
    return {
      detail: "Prodotti e filtri in preparazione.",
      title: "Apro Catalogo",
    };
  }

  if (pathname.startsWith("/app/conflicts")) {
    return {
      detail: "Decisioni e stato conflitti in preparazione.",
      title: "Apro Conflitti",
    };
  }

  if (pathname.startsWith("/app/import-preview")) {
    return {
      detail: "Anteprima e controlli in preparazione.",
      title: "Apro Importazione",
    };
  }

  if (pathname.startsWith("/app/activity")) {
    return {
      detail: "Eventi e diagnosi in preparazione.",
      title: "Apro Attività",
    };
  }

  if (pathname.startsWith("/app/settings")) {
    return {
      detail: "Regole e collegamenti in preparazione.",
      title: "Apro Impostazioni",
    };
  }

  return {
    detail: "Stato operativo in preparazione.",
    title: "Apro Panoramica",
  };
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
