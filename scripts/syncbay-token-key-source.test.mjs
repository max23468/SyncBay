import assert from "node:assert/strict";
import test from "node:test";

import { selectTokenEncryptionKey } from "./syncbay-token-key-source.mjs";

test("prefers Keychain token encryption key for local scripts", () => {
  assert.deepEqual(
    selectTokenEncryptionKey({
      envValue: "env-key",
      keychainValue: "keychain-key",
    }),
    {
      source: "keychain",
      value: "keychain-key",
    },
  );
});

test("falls back to env token encryption key when Keychain is unavailable", () => {
  assert.deepEqual(
    selectTokenEncryptionKey({
      envValue: "env-key",
      keychainValue: null,
    }),
    {
      source: "env",
      value: "env-key",
    },
  );
});
