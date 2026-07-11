import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { decryptSecret, encryptSecret } from "./crypto.server";

// Riproduce il formato envelope `v1` cifrando con un materiale chiave arbitrario,
// per simulare gli envelope scritti dal runtime precedente con la chiave grezza.
function encryptWithKeyMaterial(plaintext: string, material: string) {
  const key = crypto.createHash("sha256").update(material).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

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

test("still decrypts legacy envelopes written with the untrimmed key", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    // Runtime precedente: segreto con fine riga, envelope cifrato con la chiave
    // grezza non trimmata.
    const rawMaterial = "syncbay-crypto-test-key\n";
    const legacyEnvelope = encryptWithKeyMaterial("token-legacy", rawMaterial);

    // Nuovo runtime con lo stesso segreto: deve ancora decifrare via fallback,
    // senza perdere l'accesso ai token già salvati.
    process.env.TOKEN_ENCRYPTION_KEY = rawMaterial;
    assert.equal(decryptSecret(legacyEnvelope), "token-legacy");
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
