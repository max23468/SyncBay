import type { ReactNode } from "react";

const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris.js";

export function PublicAppProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <script defer src={POLARIS_URL} />
      {children}
    </>
  );
}
