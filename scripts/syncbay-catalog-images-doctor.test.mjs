import assert from "node:assert/strict";
import test from "node:test";

import { resolveCatalogImagesDoctorShopDomain } from "./syncbay-catalog-images-doctor.mjs";

test("uses the explicit shop argument before environment defaults", () => {
  assert.equal(
    resolveCatalogImagesDoctorShopDomain({
      args: { shop: "arg-shop.myshopify.com" },
      env: { SHOPIFY_DEV_STORE: "env-shop.myshopify.com" },
    }),
    "arg-shop.myshopify.com",
  );
});

test("uses the loaded environment shop when no explicit shop is passed", () => {
  assert.equal(
    resolveCatalogImagesDoctorShopDomain({
      args: {},
      env: { SHOPIFY_DEV_STORE: "env-shop.myshopify.com" },
    }),
    "env-shop.myshopify.com",
  );
});

test("falls back to the SyncBay dev store when no shop is configured", () => {
  assert.equal(
    resolveCatalogImagesDoctorShopDomain({
      args: {},
      env: {},
    }),
    "syncbay-dev.myshopify.com",
  );
});
