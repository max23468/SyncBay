import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SYNCBAY_AUDIT_LOG_CREATE_SELECT } from "./syncbay-audit-log-write.ts";

const AUDIT_LOG_SERVICE_FILES = [
  "../services/ebay-account-deletion.server.ts",
  "../services/ebay.server.ts",
  "../services/shopify-draft-import.server.ts",
  "../services/sync-job-runner.server.ts",
  "../services/syncbay.server.ts",
];

test("selects only the audit log id after create writes", () => {
  assert.deepEqual(SYNCBAY_AUDIT_LOG_CREATE_SELECT, { id: true });
  assert.deepEqual(Object.keys(SYNCBAY_AUDIT_LOG_CREATE_SELECT), ["id"]);
});

test("does not let AuditLog.create return full rows in runtime services", () => {
  const missingSelects = [];

  for (const filePath of AUDIT_LOG_SERVICE_FILES) {
    const source = readFileSync(new URL(filePath, import.meta.url), "utf8");
    const createCall = "auditLog.create({";
    let index = source.indexOf(createCall);

    while (index >= 0) {
      const afterCreateCall = source.slice(index + createCall.length);

      if (
        !/^\s*select:\s*SYNCBAY_AUDIT_LOG_CREATE_SELECT\b/.test(afterCreateCall)
      ) {
        missingSelects.push(`${filePath}:${lineNumberAt(source, index)}`);
      }

      index = source.indexOf(createCall, index + createCall.length);
    }
  }

  assert.deepEqual(missingSelects, []);
});

function lineNumberAt(source: string, offset: number) {
  return source.slice(0, offset).split("\n").length;
}
