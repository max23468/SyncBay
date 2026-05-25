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

function getTokenKey() {
  const rawKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY non configurata.");
  }

  return crypto.createHash("sha256").update(rawKey).digest();
}
