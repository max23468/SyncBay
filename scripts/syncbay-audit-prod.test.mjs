import assert from "node:assert/strict";
import { test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  evaluateAudit,
  readAuditVulnerabilities,
  reconcileScheduledAudit,
} from "./syncbay-audit-prod.mjs";

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

function fixture({
  id = "GHSA-aaaa-bbbb-cccc",
  severity = "high",
  score = 7.5,
  range = "<1.0.1",
  extra = false,
} = {}) {
  const advisory = {
    source: 123,
    name: "synthetic-uri",
    url: `https://github.com/advisories/${id}`,
    severity,
    range,
    cvss: { score },
  };
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "synthetic-parent": { severity, via: ["synthetic-uri"] },
      "synthetic-uri": {
        severity,
        via: [
          advisory,
          ...(extra
            ? [{ ...advisory, url: "https://github.com/advisories/GHSA-dddd-eeee-ffff" }]
            : []),
        ],
      },
    },
  };
}

function evaluate(report = fixture(), status = 1) {
  return evaluateAudit({ stdout: JSON.stringify(report), status });
}

function issueFixture() {
  const issues = [];
  const comments = [];
  let failApi = false;
  return {
    issues,
    comments,
    fail() {
      failApi = true;
    },
    async run(result) {
      return reconcileScheduledAudit({
        result,
        repository: "synthetic/project",
        runUrl: "https://github.com/synthetic/project/actions/runs/1",
        api: async (endpoint, data, paginate) => {
          if (failApi) throw new Error("API fixture non disponibile");
          if (paginate) return structuredClone(issues);
          if (endpoint.endsWith("/comments")) {
            comments.push(data.body);
            return {};
          }
          if (endpoint.endsWith("/issues")) {
            issues.push({
              ...data,
              number: 1,
              state: "open",
              user: { login: "github-actions[bot]" },
            });
            return issues[0];
          }
          Object.assign(issues[0], data);
          return issues[0];
        },
      });
    },
  };
}

test("scheduled first finding fails, unchanged repeats update one issue without comments, resolution closes it", async () => {
  const tracker = issueFixture();
  const finding = evaluate();
  assert.equal(finding.error, null);
  assert.equal((await tracker.run(finding)).fail, true);
  assert.equal(tracker.issues.length, 1);
  assert.deepEqual(await tracker.run(finding), { fail: false, transition: "già segnalato" });
  assert.equal(tracker.comments.length, 0);
  assert.equal((await tracker.run(evaluate(fixture({ extra: true })))).fail, true);
  assert.equal(tracker.comments.length, 1);
  assert.deepEqual(await tracker.run(evaluate({ auditReportVersion: 2, vulnerabilities: {} }, 0)), {
    fail: false,
    transition: "risoluzione",
  });
  assert.equal(tracker.issues[0].state, "closed");
  assert.equal(tracker.comments.length, 2);
  assert.match(tracker.comments[1], /risoluzione/);
  assert.equal(
    (await tracker.run(evaluate({ auditReportVersion: 2, vulnerabilities: {} }, 0))).fail,
    false,
  );
  assert.equal(tracker.comments.length, 2);
  assert.equal((await tracker.run(finding)).fail, true);
  assert.equal(tracker.issues[0].state, "open");
  assert.equal(tracker.issues.length, 1);
});

test("escalation of severity, CVSS or affected range signals a change", async () => {
  for (const change of [{ severity: "critical" }, { score: 9.1 }, { range: "<1.0.2" }]) {
    const tracker = issueFixture();
    await tracker.run(evaluate());
    assert.equal((await tracker.run(evaluate(fixture(change)))).fail, true);
    assert.equal(tracker.comments.length, 1);
  }
});

test("advisory order, npm source IDs and transitive package presentation do not create new signals", async () => {
  const tracker = issueFixture();
  const report = fixture({ extra: true });
  await tracker.run(evaluate(report));
  report.vulnerabilities["synthetic-uri"].via.reverse();
  report.vulnerabilities["synthetic-uri"].via[0].source = 999;
  delete report.vulnerabilities["synthetic-parent"];
  assert.equal((await tracker.run(evaluate(report))).fail, false);
  assert.equal(tracker.comments.length, 0);
});

test("audit errors always fail, preserve open findings and never close the issue", async () => {
  const tracker = issueFixture();
  await tracker.run(evaluate());
  const error = evaluate({ error: { code: "E403" }, auditReportVersion: 2 });
  assert.equal((await tracker.run(error)).fail, true);
  assert.equal((await tracker.run(error)).fail, true);
  assert.equal(tracker.issues[0].state, "open");
  assert.match(tracker.issues[0].body, /GHSA-aaaa-bbbb-cccc/);
  assert.equal(tracker.comments.length, 1);
  assert.equal((await tracker.run(evaluate())).fail, true);
});

test("clean initial run creates no issue; first audit error creates the only issue", async () => {
  const tracker = issueFixture();
  assert.equal(
    (await tracker.run(evaluate({ auditReportVersion: 2, vulnerabilities: {} }, 0))).fail,
    false,
  );
  assert.equal(tracker.issues.length, 0);
  assert.equal((await tracker.run({ findings: [], error: "Audit non disponibile" })).fail, true);
  assert.equal(tracker.issues.length, 1);
});

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

test("one advisory can cover multiple affected release ranges", async () => {
  const report = fixture();
  const via = report.vulnerabilities["synthetic-uri"].via;
  via.push({ ...via[0], range: ">=2.0.0 <2.0.1" });
  const result = evaluate(report);
  assert.equal(result.error, null);
  assert.equal(result.findings.length, 2);
  const tracker = issueFixture();
  assert.equal((await tracker.run(result)).fail, true);
  via.reverse();
  assert.equal((await tracker.run(evaluate(report))).fail, false);
});

test("issue failures, corrupt state and duplicate tracking issues cannot suppress the audit", async () => {
  const tracker = issueFixture();
  await tracker.run(evaluate());
  tracker.issues.push(structuredClone(tracker.issues[0]));
  await assert.rejects(tracker.run(evaluate()), /stato ambiguo/);
  tracker.issues.pop();
  tracker.issues[0].body = "<!-- syncbay-audit-prod -->";
  await assert.rejects(tracker.run(evaluate()), /Stato issue audit non valido/);
  tracker.fail();
  await assert.rejects(tracker.run(evaluate()), /API fixture non disponibile/);
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
      GITHUB_EVENT_NAME: "pull_request",
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
    assert.equal(
      spawnSync(process.execPath, [script.pathname, "--scheduled"], { env, encoding: "utf8" })
        .status,
      1,
    );
    const issuePath = path.join(directory, "issues.json");
    fs.writeFileSync(
      path.join(directory, "gh"),
      `#!${process.execPath}
const fs = require('node:fs');
const file = ${JSON.stringify(issuePath)};
const issues = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
const args = process.argv.slice(2);
const endpoint = args[1];
if (args.includes('--paginate')) {
  if (!args.includes('--slurp')) process.exit(2);
  console.log(JSON.stringify([issues]));
} else {
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  const method = args[args.indexOf('--method') + 1];
  if (endpoint.endsWith('/issues')) {
    if (method !== 'POST') process.exit(2);
    issues.push({ ...data, number: 1, state: 'open', user: { login: 'github-actions[bot]' } });
  } else if (!endpoint.endsWith('/comments')) {
    if (method !== 'PATCH') process.exit(2);
    Object.assign(issues[0], data);
  } else if (method !== 'POST') process.exit(2);
  fs.writeFileSync(file, JSON.stringify(issues));
  console.log('{}');
}
`,
      { mode: 0o755 },
    );
    const scheduledEnv = {
      ...env,
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_REPOSITORY: "synthetic/project",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_RUN_ID: "1",
    };
    const scheduled = () =>
      spawnSync(process.execPath, [script.pathname, "--scheduled", "--report", reportPath], {
        env: scheduledEnv,
        encoding: "utf8",
      });
    assert.equal(scheduled().status, 1);
    const repeated = scheduled();
    assert.equal(repeated.status, 0);
    assert.match(repeated.stdout, /già segnalato/);
    assert.doesNotMatch(repeated.stdout, /Audit produzione pulito/);
    assert.equal(JSON.parse(fs.readFileSync(issuePath)).length, 1);
    fs.writeFileSync(npm, `#!${process.execPath}\nconsole.log('{}');\n`, { mode: 0o755 });
    assert.equal(
      spawnSync(process.execPath, [script.pathname], { env, encoding: "utf8" }).status,
      1,
    );
    assert.equal(scheduled().status, 1);
    assert.equal(scheduled().status, 1);
    fs.writeFileSync(
      npm,
      `#!${process.execPath}\nconsole.log('{"auditReportVersion":2,"vulnerabilities":{}}');\n`,
      { mode: 0o755 },
    );
    assert.equal(
      spawnSync(process.execPath, [script.pathname], { env, encoding: "utf8" }).status,
      0,
    );
    assert.equal(scheduled().status, 0);
    assert.equal(JSON.parse(fs.readFileSync(issuePath))[0].state, "closed");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
