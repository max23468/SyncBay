#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (import.meta.main) {
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

  let vulnerabilities;
  try {
    vulnerabilities = readAuditVulnerabilities(report);
  } catch (error) {
    console.error("Audit produzione fallito.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const unexpected = findUnexpectedAuditEntries(vulnerabilities);

  if (unexpected.length > 0) {
    console.error("Audit produzione fallito.");
    for (const [name, vulnerability] of unexpected) {
      console.error(`- ${name}: ${vulnerability.severity}`);
    }
    process.exit(1);
  }
}

export function findUnexpectedAuditEntries(vulnerabilities) {
  return Object.entries(vulnerabilities);
}

export function readAuditVulnerabilities(report) {
  if (isRecord(report?.error)) {
    throw new Error("npm audit ha restituito un errore invece del report vulnerabilità.");
  }

  if (!isRecord(report?.vulnerabilities)) {
    throw new Error("npm audit non ha restituito il blocco vulnerabilities; audit non affidabile.");
  }

  return report.vulnerabilities;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
