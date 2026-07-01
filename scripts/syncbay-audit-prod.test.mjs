import assert from "node:assert/strict";
import test from "node:test";

import { findUnexpectedAuditEntries } from "./syncbay-audit-prod.mjs";

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

test("accepts only the known Prisma 7 advisory chain", () => {
  assert.deepEqual(findUnexpectedAuditEntries(knownPrisma7Audit), []);
});

test("rejects additional advisories on allowlisted Prisma packages", () => {
  const vulnerabilities = {
    ...knownPrisma7Audit,
    prisma: {
      ...knownPrisma7Audit.prisma,
      via: ["@prisma/dev", { source: 9999999 }],
    },
  };

  assert.deepEqual(findUnexpectedAuditEntries(vulnerabilities), [
    ["prisma", vulnerabilities.prisma],
  ]);
});

test("rejects unrelated production vulnerabilities", () => {
  const vulnerabilities = {
    ...knownPrisma7Audit,
    lodash: {
      severity: "moderate",
      via: [{ source: 123 }],
    },
  };

  assert.deepEqual(findUnexpectedAuditEntries(vulnerabilities), [
    ["lodash", vulnerabilities.lodash],
  ]);
});
