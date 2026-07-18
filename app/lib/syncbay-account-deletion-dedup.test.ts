import assert from "node:assert/strict";
import { test } from "vitest";

import {
  getAccountDeletionDedupAnchor,
  getAccountDeletionPersistenceMode,
} from "./syncbay-account-deletion-dedup.ts";

test("uses eventDate as the strongest account deletion dedupe anchor", () => {
  const eventDate = new Date("2026-06-21T08:00:00.000Z");
  const publishDate = new Date("2026-06-21T08:00:03.000Z");

  assert.deepEqual(getAccountDeletionDedupAnchor({ eventDate, publishDate }), {
    field: "eventDate",
    value: eventDate,
  });
});

test("falls back to publishDate when eventDate is missing", () => {
  const publishDate = new Date("2026-06-21T08:00:03.000Z");

  assert.deepEqual(
    getAccountDeletionDedupAnchor({ eventDate: null, publishDate }),
    { field: "publishDate", value: publishDate },
  );
});

test("does not dedupe account deletion requests without stable dates", () => {
  assert.equal(
    getAccountDeletionDedupAnchor({
      eventDate: new Date("not-a-date"),
      publishDate: null,
    }),
    null,
  );
});

test("keeps no-match account deletion notifications out of persistent logs", () => {
  assert.equal(
    getAccountDeletionPersistenceMode({ matchedShopCount: 0 }),
    "noop",
  );
  assert.equal(
    getAccountDeletionPersistenceMode({ matchedShopCount: 1 }),
    "persist",
  );
});
