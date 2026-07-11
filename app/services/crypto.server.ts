import crypto from "node:crypto";

import { isEncryptedSecretEnvelope } from "../lib/syncbay-secret-envelope";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encryptSecret(plaintext: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getTokenKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(secret: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
    secret.split(".");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("Formato segreto cifrato non valido.");
  }

  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedAuthTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");

  // Prova prima la chiave normalizzata (nuovi envelope e script CLI), poi la
  // chiave grezza: gli envelope scritti dal runtime precedente, quando il
  // segreto aveva spazi/fine riga, erano cifrati con la chiave non trimmata e
  // vanno ancora decifrati invece di perdere l'accesso ai token già salvati.
  let lastError: unknown;
  for (const key of getTokenKeyCandidates()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Segreto cifrato non decifrabile.");
}

export function encryptSecretIfNeeded(value: string) {
  if (!value || isEncryptedSecretEnvelope(value)) return value;

  return encryptSecret(value);
}

export function hashState(state: string) {
  return crypto.createHash("sha256").update(state).digest("hex");
}

export function hashSecretIdentifier(value: string, purpose: string) {
  return crypto
    .createHmac("sha256", getTokenKey())
    .update(purpose)
    .update(":")
    .update(value)
    .digest("hex");
}

export function createOAuthState() {
  return crypto.randomBytes(32).toString("base64url");
}

function getTokenKeyMaterial() {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (typeof rawKey !== "string" || !rawKey.trim()) {
    throw new Error("TOKEN_ENCRYPTION_KEY non configurata.");
  }

  return rawKey;
}

function deriveTokenKey(material: string) {
  return crypto.createHash("sha256").update(material).digest();
}

// Chiave canonica: normalizzata (trim) come gli script CLI
// (`selectTokenEncryptionKey`), che impostano `process.env.TOKEN_ENCRYPTION_KEY`
// al valore trimmato prima di cifrare. Usata per cifratura e HMAC così i nuovi
// envelope restano allineati tra script locali e runtime Vercel.
function getTokenKey() {
  return deriveTokenKey(getTokenKeyMaterial().trim());
}

// Chiavi candidate per la decifratura, dalla canonica alla grezza, senza
// duplicati quando il segreto non ha spazi da normalizzare.
function getTokenKeyCandidates() {
  const material = getTokenKeyMaterial();
  const normalized = material.trim();
  const candidates = [normalized];
  if (material !== normalized) candidates.push(material);

  return candidates.map(deriveTokenKey);
}
