import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node --experimental-strip-types resolves this test import.
import { shouldWriteShopifyWebhookAuditLog } from "./syncbay-webhook-audit.ts";

test("writes one audit entry when a webhook creates a new job", () => {
  assert.equal(
    shouldWriteShopifyWebhookAuditLog({
      jobCoalesced: false,
      jobCreated: true,
      jobType: "DETECT_SHOPIFY_CHANGES",
    }),
    true,
  );
});

test("skips noisy audit entries when a webhook only coalesces an existing job", () => {
  assert.equal(
    shouldWriteShopifyWebhookAuditLog({
      jobCoalesced: true,
      jobCreated: false,
      jobType: "DETECT_SHOPIFY_CHANGES",
    }),
    false,
  );
});

test("skips noisy audit entries for duplicate webhook deliveries", () => {
  assert.equal(
    shouldWriteShopifyWebhookAuditLog({
      jobCoalesced: false,
      jobCreated: false,
      jobType: "DETECT_SHOPIFY_CHANGES",
    }),
    false,
  );
});

test("keeps unsupported webhook topics auditable because they have no job trace", () => {
  assert.equal(
    shouldWriteShopifyWebhookAuditLog({
      jobCoalesced: false,
      jobCreated: false,
      jobType: null,
    }),
    true,
  );
});
