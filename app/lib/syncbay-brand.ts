import type { MetaDescriptor } from "react-router";

export const SYNCBAY_APP_NAME = "SyncBay";
export const SYNCBAY_TAGLINE = "Dal tuo negozio eBay a Shopify, pronto a vendere.";

export const SYNCBAY_BRAND_ASSETS = {
  appleTouchIcon: "/apple-touch-icon.png",
  faviconIco: "/favicon.ico",
  icon192: "/syncbay-icon-192.png",
  logoHorizontal: "/syncbay-logo-horizontal.png",
} as const;

export function getSyncBayPageTitle(pageTitle?: string) {
  return pageTitle ? `${pageTitle} - ${SYNCBAY_APP_NAME}` : SYNCBAY_APP_NAME;
}

export function getSyncBayMeta(pageTitle?: string): MetaDescriptor[] {
  const title = getSyncBayPageTitle(pageTitle);

  return [
    { title },
    { name: "application-name", content: SYNCBAY_APP_NAME },
    { name: "apple-mobile-web-app-title", content: SYNCBAY_APP_NAME },
    { name: "description", content: SYNCBAY_TAGLINE },
    { property: "og:site_name", content: SYNCBAY_APP_NAME },
    { property: "og:title", content: title },
    { property: "og:description", content: SYNCBAY_TAGLINE },
  ];
}
