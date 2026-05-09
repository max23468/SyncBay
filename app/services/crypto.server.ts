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

export function decryptSecret(payload: string) {
  const [version, iv, authTag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    throw new Error("Formato secret cifrato non valido.");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getTokenKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashState(state: string) {
  return crypto.createHash("sha256").update(state).digest("hex");
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
