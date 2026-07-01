#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const allowedPrisma7Vulnerabilities = new Set([
  "@hono/node-server",
  "@prisma/dev",
  "prisma",
]);
const allowedAdvisorySource = 1116281;

if (isCliEntrypoint()) {
  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
  });

  if (audit.error) {
    console.error(`Impossibile eseguire npm audit: ${audit.error.message}`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(audit.stdout || "{}");
  } catch (error) {
    console.error("Output npm audit non valido.");
    console.error(error);
    process.exit(1);
  }

  if (audit.status === 0) {
    console.log("Audit produzione pulito.");
    process.exit(0);
  }

  const vulnerabilities = report.vulnerabilities ?? {};
  const entries = Object.entries(vulnerabilities);
  const unexpected = findUnexpectedAuditEntries(vulnerabilities);

  if (unexpected.length > 0) {
    console.error("Audit produzione fallito.");
    for (const [name, vulnerability] of entries) {
      console.error(`- ${name}: ${vulnerability.severity}`);
    }
    process.exit(1);
  }

  console.warn(
    "Audit produzione: accettata eccezione nota Prisma 7 moderata GHSA-92pp-h63x-v22m.",
  );
}

export function findUnexpectedAuditEntries(vulnerabilities) {
  return Object.entries(vulnerabilities).filter(([name]) => {
    return !isAllowedKnownPrisma7Vulnerability(name, vulnerabilities);
  });
}

function isAllowedKnownPrisma7Vulnerability(
  name,
  vulnerabilities,
  seen = new Set(),
) {
  const vulnerability = vulnerabilities[name];

  if (
    !allowedPrisma7Vulnerabilities.has(name) ||
    vulnerability?.severity !== "moderate" ||
    seen.has(name)
  ) {
    return false;
  }

  seen.add(name);

  return (vulnerability.via ?? []).every((item) => {
    if (typeof item === "string") {
      return isAllowedKnownPrisma7Vulnerability(
        item,
        vulnerabilities,
        new Set(seen),
      );
    }

    return item?.source === allowedAdvisorySource;
  });
}

function isCliEntrypoint() {
  return process.argv[1]?.endsWith("syncbay-audit-prod.mjs") ?? false;
}
