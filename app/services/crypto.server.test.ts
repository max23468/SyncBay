import assert from "node:assert/strict";
import { test } from "vitest";

import { decryptSecret, encryptSecret, encryptSecretIfNeeded } from "./crypto.server";

test("normalizes whitespace in TOKEN_ENCRYPTION_KEY so scripts and runtime match", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    // Uno script CLI cifra con la chiave trimmata (`selectTokenEncryptionKey`).
    process.env.TOKEN_ENCRYPTION_KEY = "syncbay-crypto-test-key";
    const envelope = encryptSecret("token-segreto");

    // Il runtime legge lo stesso segreto con newline/spazio finale (es. env
    // Vercel) e deve comunque decifrare l'envelope scritto dallo script.
    process.env.TOKEN_ENCRYPTION_KEY = "syncbay-crypto-test-key\n";
    assert.equal(decryptSecret(envelope), "token-segreto");

    process.env.TOKEN_ENCRYPTION_KEY = "  syncbay-crypto-test-key  ";
    assert.equal(decryptSecret(envelope), "token-segreto");
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("throws when TOKEN_ENCRYPTION_KEY is only whitespace", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    process.env.TOKEN_ENCRYPTION_KEY = "   ";
    assert.throws(() => encryptSecret("x"), /TOKEN_ENCRYPTION_KEY non configurata/);
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});

test("encrypts plaintext once and preserves complete v1 envelopes", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    process.env.TOKEN_ENCRYPTION_KEY = "syncbay-crypto-test-key";
    const encrypted = encryptSecretIfNeeded("token-plain");

    assert.match(encrypted, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
    assert.equal(encryptSecretIfNeeded(encrypted), encrypted);
    assert.notEqual(encryptSecretIfNeeded("v1.incomplete"), "v1.incomplete");
  } finally {
    process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});
