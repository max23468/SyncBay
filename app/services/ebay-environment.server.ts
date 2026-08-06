type EbayEnvironment = "production" | "sandbox";

export const DEFAULT_EBAY_MARKETPLACE_ID = "EBAY_IT";

const EBAY_API_BASE_URLS = {
  production: "https://api.ebay.com",
  sandbox: "https://api.sandbox.ebay.com",
};

export function getEbayBasicAuthHeader() {
  return Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
    "utf8",
  ).toString("base64");
}

export function getEbayEnvironment(environment = process.env.EBAY_ENVIRONMENT): EbayEnvironment {
  return environment?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

export function getEbayApiBaseUrl(environment?: string | null) {
  return EBAY_API_BASE_URLS[getEbayEnvironment(environment ?? undefined)];
}

export function getEbayTokenUrl(environment?: string | null) {
  return `${getEbayApiBaseUrl(environment)}/identity/v1/oauth2/token`;
}

export function getEbayMarketplaceId(
  marketplaceId: string | null | undefined = process.env.EBAY_MARKETPLACE_ID,
) {
  return marketplaceId ?? DEFAULT_EBAY_MARKETPLACE_ID;
}

export function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}
