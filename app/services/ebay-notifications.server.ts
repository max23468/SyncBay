import crypto from "node:crypto";

interface EbayApplicationTokenResponse {
  access_token: string;
  expires_in?: number;
}

interface EbayPublicKeyResponse {
  algorithm?: string;
  digest?: string;
  key?: string;
}

interface EbaySignatureHeader {
  alg?: string;
  digest?: string;
  kid?: string;
  signature?: string;
}

interface CachedApplicationToken {
  accessToken: string;
  expiresAt: number;
}

interface CachedPublicKey {
  key: string;
  expiresAt: number;
}

const EBAY_TOKEN_URLS = {
  production: "https://api.ebay.com/identity/v1/oauth2/token",
  sandbox: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
};

const EBAY_PUBLIC_KEY_URLS = {
  production: "https://api.ebay.com/commerce/notification/v1/public_key",
  sandbox: "https://api.sandbox.ebay.com/commerce/notification/v1/public_key",
};

const EBAY_APPLICATION_SCOPE = "https://api.ebay.com/oauth/api_scope";
const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000;
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

let cachedApplicationToken: CachedApplicationToken | null = null;
const publicKeyCache = new Map<string, CachedPublicKey>();

export class EbayNotificationSignatureError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "EbayNotificationSignatureError";
  }
}

export async function verifyEbayNotificationSignature(input: {
  body: Buffer;
  signatureHeader: string | null;
}) {
  const header = parseSignatureHeader(input.signatureHeader);
  const publicKey = await getEbayPublicKey(header.kid);
  const verifier = crypto.createVerify("sha1");
  verifier.update(input.body);
  verifier.end();

  const signature = decodeBase64(header.signature);
  const valid = verifier.verify(publicKey, signature);
  if (!valid) {
    throw new EbayNotificationSignatureError(
      "Firma eBay non valida.",
      "signature_invalid",
    );
  }

  return {
    algorithm: header.alg ?? null,
    digest: header.digest ?? null,
    keyId: header.kid,
  };
}

function parseSignatureHeader(signatureHeader: string | null) {
  if (!signatureHeader) {
    throw new EbayNotificationSignatureError(
      "Header X-EBAY-SIGNATURE mancante.",
      "signature_missing",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeBase64(signatureHeader).toString("utf8"));
  } catch {
    throw new EbayNotificationSignatureError(
      "Header X-EBAY-SIGNATURE non leggibile.",
      "signature_malformed",
    );
  }

  if (!decoded || typeof decoded !== "object") {
    throw new EbayNotificationSignatureError(
      "Header X-EBAY-SIGNATURE non valido.",
      "signature_malformed",
    );
  }

  const header = decoded as EbaySignatureHeader;
  if (!header.kid || !header.signature) {
    throw new EbayNotificationSignatureError(
      "Header X-EBAY-SIGNATURE incompleto.",
      "signature_malformed",
    );
  }

  return {
    alg: header.alg,
    digest: header.digest,
    kid: header.kid,
    signature: header.signature,
  };
}

async function getEbayPublicKey(publicKeyId: string) {
  const cached = publicKeyCache.get(publicKeyId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  const token = await getEbayApplicationAccessToken();
  const response = await fetch(
    `${getPublicKeyBaseUrl()}/${encodeURIComponent(publicKeyId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
  const json = (await response.json()) as EbayPublicKeyResponse & {
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok || !json.key) {
    throw new Error("Public key eBay non ottenuta.");
  }

  const key = normalizePublicKey(json.key);
  publicKeyCache.set(publicKeyId, {
    expiresAt: Date.now() + PUBLIC_KEY_CACHE_TTL_MS,
    key,
  });

  return key;
}

async function getEbayApplicationAccessToken() {
  if (cachedApplicationToken && cachedApplicationToken.expiresAt > Date.now()) {
    return cachedApplicationToken.accessToken;
  }

  const response = await fetch(getTokenUrl(), {
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: EBAY_APPLICATION_SCOPE,
    }),
    headers: {
      Authorization: `Basic ${getBasicAuthHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const json = (await response.json()) as Partial<EbayApplicationTokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? "Application token eBay non ottenuto.",
    );
  }

  cachedApplicationToken = {
    accessToken: json.access_token,
    expiresAt:
      Date.now() + Math.max((json.expires_in ?? 0) * 1000 - TOKEN_EXPIRY_SAFETY_MS, 0),
  };

  return cachedApplicationToken.accessToken;
}

function normalizePublicKey(publicKey: string) {
  if (!publicKey.includes("-----BEGIN PUBLIC KEY-----")) return publicKey;
  if (publicKey.includes("\n")) return publicKey;

  const base64Key = publicKey
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  const lines = base64Key.match(/.{1,64}/g) ?? [base64Key];

  return [
    "-----BEGIN PUBLIC KEY-----",
    ...lines,
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

function decodeBase64(value: string) {
  try {
    return Buffer.from(value, "base64");
  } catch {
    return Buffer.from(value, "base64url");
  }
}

function getBasicAuthHeader() {
  return Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
    "utf8",
  ).toString("base64");
}

function getPublicKeyBaseUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_PUBLIC_KEY_URLS.production
    : EBAY_PUBLIC_KEY_URLS.sandbox;
}

function getTokenUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_TOKEN_URLS.production
    : EBAY_TOKEN_URLS.sandbox;
}

function getEbayEnvironment() {
  return process.env.EBAY_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} non configurata.`);

  return value;
}
