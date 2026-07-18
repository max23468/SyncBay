import type { HeadersFunction } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export function getEmbeddedNoStoreHeaders(headers: HeadersInit = {}) {
  const noStoreHeaders = new Headers(headers);

  noStoreHeaders.set("Cache-Control", "no-store, max-age=0");
  noStoreHeaders.set("CDN-Cache-Control", "no-store");
  noStoreHeaders.set("Vercel-CDN-Cache-Control", "no-store");

  return noStoreHeaders;
}

export const embeddedNoStoreHeaders: HeadersFunction = (headersArgs) =>
  getEmbeddedNoStoreHeaders(boundary.headers(headersArgs));
