import assert from "node:assert/strict";
import { test } from "vitest";

import {
  findAcceptedAuditEntries,
  findUnexpectedAuditEntries,
  readAuditVulnerabilities,
} from "./syncbay-audit-prod.mjs";

// Catena reale: `react-router` porta l'advisory accettata, `@react-router/node`
// la eredita come causa transitiva.
const reactRouterAudit = {
  "@react-router/node": {
    severity: "high",
    via: ["react-router"],
  },
  "react-router": {
    severity: "high",
    via: [{ url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2" }],
  },
};

test("accepts the documented React Router advisory and its transitive effect", () => {
  assert.deepEqual(findUnexpectedAuditEntries(reactRouterAudit), []);
  assert.deepEqual(
    findAcceptedAuditEntries(reactRouterAudit).map(([name]) => name),
    ["@react-router/node", "react-router"],
  );
});

// La proprieta' che rende la waiver sicura: copre quell'advisory, non il
// pacchetto. Una vulnerabilita' nuova su react-router deve tornare a fallire.
test("rejects a new advisory on a package with an accepted one", () => {
  const vulnerabilities = {
    ...reactRouterAudit,
    "react-router": {
      severity: "high",
      via: [
        { url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2" },
        { url: "https://github.com/advisories/GHSA-0000-0000-0000" },
      ],
    },
  };

  assert.deepEqual(
    findUnexpectedAuditEntries(vulnerabilities).map(([name]) => name),
    ["@react-router/node", "react-router"],
  );
});

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

test("rejects the former Prisma 7 advisory chain now covered by overrides", () => {
  assert.deepEqual(
    findUnexpectedAuditEntries(knownPrisma7Audit),
    Object.entries(knownPrisma7Audit),
  );
});

test("rejects additional advisories on allowlisted Prisma packages", () => {
  const vulnerabilities = {
    ...knownPrisma7Audit,
    prisma: {
      ...knownPrisma7Audit.prisma,
      via: ["@prisma/dev", { source: 9999999 }],
    },
  };

  assert.deepEqual(findUnexpectedAuditEntries(vulnerabilities), Object.entries(vulnerabilities));
});

test("rejects unrelated production vulnerabilities", () => {
  const vulnerabilities = {
    lodash: {
      severity: "moderate",
      via: [{ source: 123 }],
    },
  };

  assert.deepEqual(findUnexpectedAuditEntries(vulnerabilities), [
    ["lodash", vulnerabilities.lodash],
  ]);
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
