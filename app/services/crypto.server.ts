import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encryptSecret(plaintext: string) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(secret: string) {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext] = secret.split(".");
  if (version !== "v1" || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("Formato segreto cifrato non valido.");
  }

  const iv = Buffer.from(encodedIv, "base64url");
  const authTag = Buffer.from(encodedAuthTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");

  const decipher = crypto.createDecipheriv(ALGORITHM, getTokenKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptSecretIfNeeded(value: string) {
  const [version, iv, tag, ciphertext, ...extra] = value.split(".");
  if (
    !value ||
    (version === "v1" && Boolean(iv) && Boolean(tag) && Boolean(ciphertext) && extra.length === 0)
  ) {
    return value;
  }

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
// al valore trimmato prima di cifrare. Verificato 2026-07-16 che ogni envelope
// persistito si decifra con questa sola chiave: il fallback sulla chiave grezza
// non serve più.
function getTokenKey() {
  return deriveTokenKey(getTokenKeyMaterial().trim());
}
