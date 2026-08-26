import assert from "node:assert/strict";
import { test } from "vitest";

import { readAuditVulnerabilities } from "./syncbay-audit-prod.mjs";

const knownPrisma7Audit = {
  "@hono/node-server": {
    severity: "moderate",
    via: [{ source: 1116281 }],
  },
  "@prisma/dev": {
    severity: "moderate",
    via: ["@hono/node-server"],
  },
  prisma: {
    severity: "moderate",
    via: ["@prisma/dev"],
  },
};

test("preserves every production vulnerability for the blocking audit", () => {
  assert.deepEqual(
    readAuditVulnerabilities({ vulnerabilities: knownPrisma7Audit }),
    knownPrisma7Audit,
  );
});

test("rejects audit transport errors without vulnerabilities", () => {
  assert.throws(
    () =>
      readAuditVulnerabilities({
        error: {
          code: "E403",
          summary: "Forbidden",
        },
      }),
    /npm audit ha restituito un errore/,
  );
});

test("rejects non-clean audit reports without a vulnerabilities block", () => {
  assert.throws(
    () =>
      readAuditVulnerabilities({
        metadata: {
          vulnerabilities: {},
        },
      }),
    /non ha restituito il blocco vulnerabilities/,
  );
});
