import assert from "node:assert/strict";
import { test } from "vitest";

import {
  normalizeProductPublicationMode,
  parseProductPublicationGids,
  resolveProductPublicationIds,
  resolveStoredSelectedProductPublicationIds,
  serializeProductPublicationGids,
} from "./syncbay-product-publication-settings.ts";

test("normalizes unknown publication modes to all channels", () => {
  assert.equal(normalizeProductPublicationMode("ALL"), "ALL");
  assert.equal(normalizeProductPublicationMode("SELECTED"), "SELECTED");
  assert.equal(normalizeProductPublicationMode("NONE"), "NONE");
  assert.equal(normalizeProductPublicationMode("unexpected"), "ALL");
});

test("serializes and parses selected publication ids", () => {
  const serialized = serializeProductPublicationGids([
    " gid://shopify/Publication/2 ",
    "",
    "gid://shopify/Publication/1",
    "gid://shopify/Publication/2",
  ]);

  assert.equal(serialized, "gid://shopify/Publication/2,gid://shopify/Publication/1");
  assert.deepEqual(parseProductPublicationGids(serialized), [
    "gid://shopify/Publication/2",
    "gid://shopify/Publication/1",
  ]);
});

test("resolves all-channel publication mode to every available publication", () => {
  assert.deepEqual(
    resolveProductPublicationIds({
      availablePublicationIds: ["gid://shopify/Publication/1", "gid://shopify/Publication/2"],
      mode: "ALL",
      selectedPublicationIds: [],
    }),
    {
      publicationIds: ["gid://shopify/Publication/1", "gid://shopify/Publication/2"],
      status: "ready",
    },
  );
});

test("resolves selected-channel publication mode only to selected available publications", () => {
  assert.deepEqual(
    resolveProductPublicationIds({
      availablePublicationIds: ["gid://shopify/Publication/1", "gid://shopify/Publication/2"],
      mode: "SELECTED",
      selectedPublicationIds: ["gid://shopify/Publication/2", "gid://shopify/Publication/missing"],
    }),
    {
      publicationIds: ["gid://shopify/Publication/2"],
      status: "ready",
    },
  );
});

test("blocks selected-channel mode when no selected publication is available", () => {
  assert.deepEqual(
    resolveProductPublicationIds({
      availablePublicationIds: ["gid://shopify/Publication/1"],
      mode: "SELECTED",
      selectedPublicationIds: ["gid://shopify/Publication/missing"],
    }),
    {
      errorMessage: "Nessuno dei canali Shopify selezionati è disponibile per questo negozio.",
      status: "failed",
    },
  );
});

test("resolves stored selected publication ids without live availability", () => {
  assert.deepEqual(
    resolveStoredSelectedProductPublicationIds({
      selectedPublicationIds: [" gid://shopify/Publication/2 ", "gid://shopify/Publication/2"],
    }),
    {
      publicationIds: ["gid://shopify/Publication/2"],
      status: "ready",
    },
  );
});

test("blocks stored selected publication mode when no id is saved", () => {
  assert.deepEqual(
    resolveStoredSelectedProductPublicationIds({
      selectedPublicationIds: [],
    }),
    {
      errorMessage: "Nessuno dei canali Shopify selezionati è disponibile per questo negozio.",
      status: "failed",
    },
  );
});

test("resolves disabled publication mode without channel ids", () => {
  assert.deepEqual(
    resolveProductPublicationIds({
      availablePublicationIds: ["gid://shopify/Publication/1"],
      mode: "NONE",
      selectedPublicationIds: ["gid://shopify/Publication/1"],
    }),
    {
      publicationIds: [],
      status: "disabled",
    },
  );
});
