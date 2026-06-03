import type { LinksFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import syncbayEmbeddedStyles from "./styles/syncbay-embedded.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: syncbayEmbeddedStyles },
];

export default function App() {
  return (
    <html lang="it">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <Analytics />
        <SpeedInsights />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
