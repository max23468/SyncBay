import assert from "node:assert/strict";
import { test } from "vitest";

import * as syncbayBrand from "./syncbay-brand.ts";

const {
  SYNCBAY_APP_NAME,
  SYNCBAY_BRAND_ASSETS,
  SYNCBAY_TAGLINE,
  getSyncBayMeta,
  getSyncBayPageTitle,
} = syncbayBrand;

test("builds browser titles with SyncBay as stable suffix", () => {
  assert.equal(SYNCBAY_APP_NAME, "SyncBay");
  assert.equal(getSyncBayPageTitle(), "SyncBay");
  assert.equal(getSyncBayPageTitle("Catalogo"), "Catalogo - SyncBay");
});

test("exposes the approved public brand assets", () => {
  assert.deepEqual(SYNCBAY_BRAND_ASSETS, {
    appleTouchIcon: "/apple-touch-icon.png",
    faviconIco: "/favicon.ico",
    icon192: "/syncbay-icon-192.png",
    logoHorizontal: "/syncbay-logo-horizontal.png",
  });
});

test("adds SyncBay metadata for browser tabs and previews", () => {
  const meta = getSyncBayMeta("Panoramica");

  assert.deepEqual(meta[0], { title: "Panoramica - SyncBay" });
  assert(
    meta.some(
      (entry) =>
        "name" in entry &&
        entry.name === "application-name" &&
        entry.content === "SyncBay",
    ),
  );
  assert(
    meta.some(
      (entry) =>
        "property" in entry &&
        entry.property === "og:site_name" &&
        entry.content === "SyncBay",
    ),
  );
  assert(
    meta.some(
      (entry) =>
        "name" in entry &&
        entry.name === "description" &&
        entry.content === SYNCBAY_TAGLINE,
    ),
  );
});
