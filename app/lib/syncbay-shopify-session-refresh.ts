export const SHOPIFY_OFFLINE_TOKEN_REFRESH_SAFETY_MS = 5 * 60 * 1000;

export function shouldRefreshOfflineShopifySession(
  expires: Date | null,
  now: Date,
) {
  if (!expires) return false;

  return (
    expires.getTime() <=
    now.getTime() + SHOPIFY_OFFLINE_TOKEN_REFRESH_SAFETY_MS
  );
}
