#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

if (import.meta.main) {
  try {
    const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = evaluateAudit(audit);
    const reportIndex = process.argv.indexOf("--report");
    if (reportIndex !== -1) {
      const destination = process.argv[reportIndex + 1];
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify({ ...result, stdout: audit.stdout }, null, 2));
    }
    console.log(
      result.error ??
        (result.findings.length
          ? "Audit produzione: vulnerabilità rilevate."
          : "Audit produzione pulito."),
    );
    for (const finding of result.findings) console.log(`- ${finding.id}: ${finding.severity}`);
    process.exitCode = result.error || result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
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

export function evaluateAudit(audit) {
  try {
    if (audit.error || audit.signal || ![0, 1].includes(audit.status))
      throw new Error("Esecuzione npm audit non riuscita.");
    const report = JSON.parse(audit.stdout);
    if (report.auditReportVersion !== 2) throw new Error("Formato npm audit non supportato.");
    const vulnerabilities = readAuditVulnerabilities(report);
    const findings = new Map();
    for (const vulnerability of Object.values(vulnerabilities)) {
      if (
        !SEVERITIES.includes(vulnerability?.severity) ||
        !Array.isArray(vulnerability.via) ||
        !vulnerability.via.length
      )
        throw new Error("Vulnerabilità npm audit non valida.");
      for (const via of vulnerability.via) {
        if (typeof via === "string") {
          if (!vulnerabilities[via]) throw new Error("Catena advisory npm audit incompleta.");
          continue;
        }
        if (
          !isRecord(via) ||
          !SEVERITIES.includes(via.severity) ||
          typeof via.name !== "string" ||
          typeof via.range !== "string"
        )
          throw new Error("Advisory npm audit non valido.");
        const id = via.url?.match(/^https:\/\/github\.com\/advisories\/(GHSA-[\w-]+)$/)?.[1];
        if (!id) throw new Error("Identità advisory npm audit non riconosciuta.");
        const finding = {
          id,
          name: via.name,
          severity: via.severity,
          score: via.cvss?.score ?? null,
          range: via.range,
        };
        if (
          finding.score !== null &&
          (typeof finding.score !== "number" || finding.score < 0 || finding.score > 10)
        )
          throw new Error("Punteggio advisory non valido.");
        const key = `${id}:${via.name}:${via.range}`;
        if (findings.has(key) && JSON.stringify(findings.get(key)) !== JSON.stringify(finding))
          throw new Error("Advisory npm audit incoerente.");
        findings.set(key, finding);
      }
    }
    const sorted = [...findings.values()].sort((a, b) =>
      `${a.id}:${a.name}:${a.range}`.localeCompare(`${b.id}:${b.name}:${b.range}`),
    );
    function reachesAdvisory(name, visited = new Set()) {
      if (visited.has(name)) return false;
      visited.add(name);
      return vulnerabilities[name].via.some(
        (via) => typeof via !== "string" || reachesAdvisory(via, new Set(visited)),
      );
    }
    if (Object.keys(vulnerabilities).some((name) => !reachesAdvisory(name)))
      throw new Error("Catena npm audit senza advisory identificabile.");
    if (
      (Object.keys(vulnerabilities).length && !sorted.length) ||
      (audit.status === 1 && !sorted.length) ||
      (audit.status === 0 && sorted.length)
    )
      throw new Error("Esito npm audit incoerente con le vulnerabilità.");
    return { findings: sorted, error: null };
  } catch (error) {
    return { findings: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
