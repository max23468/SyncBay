import type { LinksFunction, MetaFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

import {
  getSyncBayMeta,
  SYNCBAY_BRAND_ASSETS,
} from "./lib/syncbay-brand";
import syncbayEmbeddedStyles from "./styles/syncbay-embedded.css?url";

export const meta: MetaFunction = () => getSyncBayMeta();

export const links: LinksFunction = () => [
  {
    rel: "icon",
    href: SYNCBAY_BRAND_ASSETS.faviconIco,
    type: "image/x-icon",
  },
  {
    rel: "icon",
    href: SYNCBAY_BRAND_ASSETS.icon192,
    sizes: "192x192",
    type: "image/png",
  },
  {
    rel: "apple-touch-icon",
    href: SYNCBAY_BRAND_ASSETS.appleTouchIcon,
    sizes: "180x180",
  },
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
