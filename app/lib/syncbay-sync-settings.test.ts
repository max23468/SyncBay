import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { getSyncEnablementBlockers } from "./syncbay-sync-settings.ts";

test("allows disabling sync without readiness blockers", () => {
  assert.deepEqual(
    getSyncEnablementBlockers({
      activeMappingCount: 0,
      ebayConnected: false,
      hasDefaultLocation: false,
      requestedSyncEnabled: false,
    }),
    [],
  );
});

test("allows enabling sync when eBay, location and mappings are ready", () => {
  assert.deepEqual(
    getSyncEnablementBlockers({
      activeMappingCount: 1,
      ebayConnected: true,
      hasDefaultLocation: true,
      requestedSyncEnabled: true,
    }),
    [],
  );
});

test("blocks enabling sync until prerequisites are ready", () => {
  assert.deepEqual(
    getSyncEnablementBlockers({
      activeMappingCount: 0,
      ebayConnected: false,
      hasDefaultLocation: false,
      requestedSyncEnabled: true,
    }),
    [
      "account eBay non collegato",
      "location Shopify predefinita mancante",
      "nessun prodotto importato",
    ],
  );
});
