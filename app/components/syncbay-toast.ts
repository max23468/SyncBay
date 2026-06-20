type ToastOptions = { duration?: number; isError?: boolean };

type ShopifyToastGlobal = {
  toast?: { show?: (message: string, options?: ToastOptions) => void };
};

function getShopifyToast(): ShopifyToastGlobal["toast"] | undefined {
  if (typeof window === "undefined") return undefined;

  return (window as unknown as { shopify?: ShopifyToastGlobal }).shopify?.toast;
}

/**
 * Mostra un toast App Bridge in modo sicuro (no-op fuori dall'admin embedded,
 * es. SSR/preview). Punto unico per il feedback delle azioni.
 */
export function showSyncBayToast(message: string, options?: ToastOptions) {
  getShopifyToast()?.show?.(message, options);
}
