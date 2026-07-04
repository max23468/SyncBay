export function resolveRequiredShopDomainOption(input = {}) {
  const shopDomain = normalizeShopDomain(
    input.args?.shop ?? input.env?.SHOPIFY_DEV_STORE,
  );

  if (shopDomain) return shopDomain;

  throw new Error(
    "Specifica lo shop con --shop <dominio.myshopify.com> oppure configura SHOPIFY_DEV_STORE.",
  );
}

function normalizeShopDomain(value) {
  if (typeof value !== "string") return null;

  const shopDomain = value.trim();

  return shopDomain ? shopDomain : null;
}
