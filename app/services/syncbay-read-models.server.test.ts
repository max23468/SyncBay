import assert from "node:assert/strict";
import { test, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  count: vi.fn(async () => 0),
  findFirst: vi.fn(async () => null),
  findMany: vi.fn(async () => []),
  findUnique: vi.fn(async () => null),
  scopes: [
    "read_products",
    "write_products",
    "read_inventory",
    "write_inventory",
    "read_locations",
    "write_locations",
    "read_orders",
    "write_orders",
    "read_publications",
    "write_publications",
    "read_files",
    "write_files",
  ].join(","),
}));

vi.mock("../db.server", () => ({
  default: {
    $transaction: async (queries: Array<Promise<unknown>>) => Promise.all(queries),
    auditLog: { findMany: fakes.findMany },
    ebayConnection: { findUnique: fakes.findUnique },
    productMapping: { count: fakes.count, findMany: fakes.findMany },
    productSnapshot: { count: fakes.count, findMany: fakes.findMany },
    syncConflict: { count: fakes.count, findMany: fakes.findMany },
    syncJob: {
      count: fakes.count,
      findFirst: fakes.findFirst,
      findMany: fakes.findMany,
    },
  },
}));
vi.mock("./syncbay-operations.server", () => ({
  ensureShopForSession: async () => ({
    defaultLocationGid: "gid://shopify/Location/1",
    defaultProductStatus: "ACTIVE",
    id: "shop-1",
    installationStatus: "INSTALLED",
    shopDomain: "synthetic.myshopify.com",
    shopifyScopes: fakes.scopes,
    syncEnabled: true,
    syncTargetSeconds: 300,
  }),
  getAccountDeletionPostConfig: () => ({
    endpoint: null,
    missingRequirements: ["endpoint account deletion eBay"],
    notificationsEnabled: false,
  }),
  getEbayRuntimeReadiness: () => ({
    environment: "SANDBOX",
    marketplaceId: "EBAY_IT",
    missingRequirements: [],
    oauthEnabled: false,
    oauthStatus: "Predisposto, ma disabilitato da flag runtime",
    ready: true,
    summary: { detail: "Env OAuth presenti.", label: "eBay", status: "da completare" },
  }),
}));
vi.mock("./syncbay-shared.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./syncbay-shared.server")>()),
  getCatalogSummaryCounts: async () => ({
    archivedCount: 0,
    conflictCount: 0,
    freshCount: 0,
    latestIncrementalFinishedAt: null,
    needsCheckCount: 0,
    staleActiveCount: 0,
    unknownAvailabilityCount: 0,
  }),
  getExistingDescriptionRuleForSettings: async () => ({ mode: "CLEAN_HTML" }),
}));

import { getCatalogPageState } from "./syncbay-catalog.server";
import { getOverviewState } from "./syncbay-state.server";

const session = { shop: "synthetic.myshopify.com", scope: fakes.scopes };

test("overview aggrega uno shop vuoto senza inventare stato operativo", async () => {
  const state = await getOverviewState(session);

  assert.equal(state.shop.domain, session.shop);
  assert.equal(state.imports.mappingCount, 0);
  assert.equal(state.conflicts.openCount, 0);
  assert.equal(state.sync.lastRunCounts.requested, null);
  assert.equal(state.sync.lastRunCounts.synced, null);
});

test("catalogo espone una pagina vuota coerente con i conteggi", async () => {
  const state = await getCatalogPageState(session);

  assert.deepEqual(state.rows, []);
  assert.equal(state.summary.totalCount, 0);
  assert.equal(state.summary.linkedCount, 0);
  assert.equal(state.pagination.totalAvailableCount, 0);
});
