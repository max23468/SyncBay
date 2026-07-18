import assert from "node:assert/strict";
import { test } from "vitest";

import { isEncryptedSecretEnvelope } from "./syncbay-secret-envelope.ts";

test("recognizes only complete v1 encrypted envelopes", () => {
  assert.equal(isEncryptedSecretEnvelope("v1.iv.tag.cipher"), true);
  assert.equal(isEncryptedSecretEnvelope("token-plain"), false);
  assert.equal(isEncryptedSecretEnvelope("v1.incomplete"), false);
  assert.equal(isEncryptedSecretEnvelope("v2.iv.tag.cipher"), false);
  assert.equal(isEncryptedSecretEnvelope("v1..tag.cipher"), false);
});
