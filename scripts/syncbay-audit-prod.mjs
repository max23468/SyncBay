#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ISSUE_MARKER = "<!-- syncbay-audit-prod -->";
const STATE_PATTERN = /<!-- syncbay-audit-state (.+) -->/;
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
    if (process.argv.includes("--scheduled")) {
      if (process.env.GITHUB_EVENT_NAME !== "schedule")
        throw new Error("La deduplicazione è riservata alle esecuzioni programmate.");
      const outcome = await reconcileScheduledAudit({
        result,
        api: githubApi,
        repository: process.env.GITHUB_REPOSITORY,
        runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      });
      console.log(`Audit programmato: ${outcome.transition}.`);
      process.exitCode = outcome.fail ? 1 : 0;
    } else {
      process.exitCode = result.error || result.findings.length ? 1 : 0;
    }
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

export async function reconcileScheduledAudit({ result, api, repository, runUrl }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new Error("Repository GitHub non valido.");
  const endpoint = `repos/${repository}/issues`;
  // Una sola issue, anche dopo la chiusura: nessun cache o database aggiuntivo.
  const issues = await api(`${endpoint}?state=all&per_page=100`, undefined, true);
  const matches = issues.filter(
    (issue) =>
      !issue.pull_request &&
      issue.user?.login === "github-actions[bot]" &&
      issue.body?.startsWith(ISSUE_MARKER),
  );
  if (matches.length > 1) throw new Error("Più issue audit trovate: stato ambiguo.");
  const issue = matches[0];
  let previous;
  if (issue) {
    const serialized = issue.body.match(STATE_PATTERN)?.[1];
    previous = serialized && JSON.parse(serialized);
    if (
      previous?.version !== 1 ||
      !Array.isArray(previous.findings) ||
      typeof previous.error !== "boolean"
    )
      throw new Error("Stato issue audit non valido.");
  }
  const state = {
    version: 1,
    findings: result.error ? (previous?.findings ?? []) : result.findings,
    error: Boolean(result.error),
  };
  const changed = JSON.stringify(state) !== JSON.stringify(previous);
  const clean = !state.error && !state.findings.length;
  const transition = result.error
    ? "errore"
    : clean
      ? previous && (previous.error || previous.findings.length)
        ? "risoluzione"
        : "pulito"
      : changed || issue?.state === "closed"
        ? "rilevamento"
        : "già segnalato";
  if (!issue && clean) return { fail: false, transition };
  const description = result.error
    ? `Audit inattendibile: ${result.error}`
    : clean
      ? "Audit produzione pulito. Problema risolto."
      : "Vulnerabilità aperte: intervenire sulle dipendenze. La ripetizione già registrata non fa fallire la run programmata; PR e gate locali restano bloccanti.";
  const body = [
    ISSUE_MARKER,
    "## Audit dipendenze di produzione",
    description,
    ...state.findings.map(
      (finding) =>
        `- ${finding.id} | ${finding.name} | ${finding.severity} | CVSS ${finding.score ?? "n/d"} | ${finding.range}`,
    ),
    `Ultima verifica e report allegato: ${runUrl}`,
    `<!-- syncbay-audit-state ${JSON.stringify(state)} -->`,
  ].join("\n\n");
  if (!issue) {
    await api(endpoint, {
      title: "Audit produzione: dipendenze vulnerabili o audit inattendibile",
      body,
    });
  } else {
    await api(`${endpoint}/${issue.number}`, {
      body,
      state: clean ? "closed" : "open",
      ...(clean ? { state_reason: "completed" } : {}),
    });
    if (changed || transition === "rilevamento")
      await api(`${endpoint}/${issue.number}/comments`, {
        body: `Audit produzione: ${transition}.\n\n${description}\n\nReport: ${runUrl}`,
      });
  }
  return {
    fail: Boolean(result.error) || (!clean && (changed || issue?.state === "closed")),
    transition,
  };
}

function githubApi(endpoint, data, paginate = false) {
  const args = ["api", endpoint];
  if (paginate) args.push("--paginate", "--slurp");
  if (data)
    args.push(
      "--method",
      endpoint.endsWith("/comments") || /\/issues$/.test(endpoint) ? "POST" : "PATCH",
      "--input",
      "-",
    );
  const response = spawnSync("gh", args, {
    input: data ? JSON.stringify(data) : undefined,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (response.error || response.status !== 0)
    throw new Error("Impossibile leggere o aggiornare l'issue audit GitHub.");
  const parsed = JSON.parse(response.stdout);
  return paginate ? parsed.flat() : parsed;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
