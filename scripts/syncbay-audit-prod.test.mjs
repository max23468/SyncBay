import assert from "node:assert/strict";
import { test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { evaluateAudit, readAuditVulnerabilities } from "./syncbay-audit-prod.mjs";

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

function fixture() {
  const id = "GHSA-aaaa-bbbb-cccc";
  const severity = "high";
  const advisory = {
    source: 123,
    name: "synthetic-uri",
    url: `https://github.com/advisories/${id}`,
    severity,
    range: "<1.0.1",
    cvss: { score: 7.5 },
  };
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "synthetic-parent": { severity, via: ["synthetic-uri"] },
      "synthetic-uri": {
        severity,
        via: [advisory],
      },
    },
  };
}

function evaluate(report = fixture(), status = 1) {
  return evaluateAudit({ stdout: JSON.stringify(report), status });
}

test("invalid audit output and inconsistent exit statuses fail closed", () => {
  for (const execution of [
    { stdout: "invalid", status: 0 },
    { stdout: "{}", status: 0 },
    { stdout: JSON.stringify(fixture()), status: 0 },
    { stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), status: 1 },
    { stdout: JSON.stringify(fixture()), status: null, signal: "SIGTERM" },
    { error: new Error("timeout"), status: 1 },
    { stdout: JSON.stringify(fixture()), status: 2 },
  ])
    assert.ok(evaluateAudit(execution).error);
  const missing = fixture();
  delete missing.vulnerabilities["synthetic-uri"];
  assert.ok(evaluate(missing).error);
  const cycle = fixture();
  cycle.vulnerabilities.orphan = { severity: "high", via: ["orphan"] };
  assert.ok(evaluate(cycle).error);
});

test("un advisory può coprire più intervalli di versioni", () => {
  const report = fixture();
  const via = report.vulnerabilities["synthetic-uri"].via;
  via.push({ ...via[0], range: ">=2.0.0 <2.0.1" });
  const result = evaluate(report);
  assert.equal(result.error, null);
  assert.equal(result.findings.length, 2);
});

test("local and PR CLI stays blocking and saves the report even on audit failure", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "syncbay-audit-fixture-"));
  try {
    const npm = path.join(directory, "npm");
    const reportPath = path.join(directory, "report.json");
    const script = new URL("./syncbay-audit-prod.mjs", import.meta.url);
    const env = {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    };
    fs.writeFileSync(
      npm,
      `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(fixture()))}); process.exit(1);\n`,
      { mode: 0o755 },
    );
    const run = spawnSync(process.execPath, [script.pathname, "--report", reportPath], {
      env,
      encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(fs.readFileSync(reportPath)).findings.length, 1);
    fs.writeFileSync(npm, `#!${process.execPath}\nconsole.log('{}');\n`, { mode: 0o755 });
    assert.equal(
      spawnSync(process.execPath, [script.pathname], { env, encoding: "utf8" }).status,
      1,
    );
    fs.writeFileSync(
      npm,
      `#!${process.execPath}\nconsole.log('{"auditReportVersion":2,"vulnerabilities":{}}');\n`,
      { mode: 0o755 },
    );
    assert.equal(
      spawnSync(process.execPath, [script.pathname], { env, encoding: "utf8" }).status,
      0,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
