import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import prisma from "./db.server";
import { PrismaSessionStorage } from "./services/shopify-prisma-session-storage.server";

const sessionStorage =
  process.env.SYNCBAY_UI_RENDER_FIXTURE === "1"
    ? createPreviewSessionStorage()
    : new PrismaSessionStorage(prisma);

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: (process.env.SHOPIFY_SCOPES ?? process.env.SCOPES)?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.SingleMerchant,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const login = shopify.login;

function createPreviewSessionStorage() {
  return {
    deleteSession: async () => true,
    deleteSessions: async () => true,
    findSessionsByShop: async () => [],
    loadSession: async () => undefined,
    storeSession: async () => true,
  };
}
