import assert from "node:assert/strict";
import test from "node:test";

import type { ExistingCatalogFieldPolicy } from "./syncbay-existing-catalog-field-policy";
import type {
  ExistingCatalogPlannedOperation,
  ExistingCatalogTakeoverReason,
  ExistingCatalogTakeoverStatus,
} from "./syncbay-existing-catalog-takeover";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { formatExistingCatalogFieldPolicy, formatExistingCatalogOperation, formatExistingCatalogReason, formatExistingCatalogTakeoverStatus } from "./syncbay-existing-catalog-copy.ts";

test("formats every existing catalog takeover status", () => {
  const values: ExistingCatalogTakeoverStatus[] = [
    "applicabile",
    "bloccante",
    "da_rivedere",
    "gia_collegato",
  ];
  assert.deepEqual(values.map(formatExistingCatalogTakeoverStatus), [
    "applicabile",
    "bloccante",
    "da rivedere",
    "già collegato",
  ]);
});

test("formats every planned operation in Italian", () => {
  const values: ExistingCatalogPlannedOperation[] = [
    "add_syncbay_tag",
    "claim_mapping",
    "preserve_handle",
    "sync_category",
    "sync_description",
    "sync_facets",
    "sync_price",
    "sync_quantity",
    "sync_seo",
    "sync_title",
  ];
  assert.deepEqual(values.map(formatExistingCatalogOperation), [
    "aggiungere tag SyncBay",
    "creare mapping",
    "preservare handle",
    "allineare categoria",
    "ripulire descrizione",
    "allineare faccette",
    "allineare prezzo",
    "allineare disponibilità",
    "allineare SEO",
    "allineare titolo",
  ]);
});

test("formats every takeover reason in Italian", () => {
  const values: ExistingCatalogTakeoverReason[] = [
    "categoria_incerta",
    "disponibilita_ebay_non_valida",
    "immagini_mancanti",
    "match_ambiguo",
    "match_non_automatico",
    "match_shopify_mancante",
    "prezzo_ebay_non_valido",
    "varianti_non_supportate",
  ];
  assert.deepEqual(values.map(formatExistingCatalogReason), [
    "categoria incerta",
    "disponibilità eBay non valida",
    "immagini mancanti",
    "match ambiguo",
    "match non automatico",
    "match Shopify mancante",
    "prezzo eBay non valido",
    "varianti non supportate",
  ]);
});

test("describes handle images and manual tag preservation", () => {
  const policy: ExistingCatalogFieldPolicy = {
    handle: {
      currentHandle: "moneta-manuale",
      operation: "preserve",
      redirectRequired: false,
    },
    images: { operation: "preserve" },
    tags: {
      add: ["Negozio eBay"],
      preserve: ["Tag manuale"],
      remove: ["Vecchia app"],
    },
  };

  assert.deepEqual(formatExistingCatalogFieldPolicy(policy), [
    "URL preservato: moneta-manuale",
    "Immagini Shopify esistenti preservate",
    "Tag aggiunti: Negozio eBay",
    "Tag legacy rimossi: Vecchia app",
  ]);
});
