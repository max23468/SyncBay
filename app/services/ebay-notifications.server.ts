import crypto from "node:crypto";

import {
  getEbayBasicAuthHeader,
  getEbayEnvironment,
  getEbayTokenUrl,
} from "./ebay-environment.server";

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

const EBAY_PUBLIC_KEY_URLS = {
  production: "https://api.ebay.com/commerce/notification/v1/public_key",
  sandbox: "https://api.sandbox.ebay.com/commerce/notification/v1/public_key",
};

const EBAY_APPLICATION_SCOPE = "https://api.ebay.com/oauth/api_scope";
const PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000;
const PUBLIC_KEY_FAILURE_CACHE_TTL_MS = 30 * 1000;
const PUBLIC_KEY_GLOBAL_LOOKUP_LIMIT = 100;
const PUBLIC_KEY_LOOKUP_LIMIT = 20;
const PUBLIC_KEY_LOOKUP_WINDOW_MS = 60 * 1000;
const EBAY_REQUEST_TIMEOUT_MS = 5 * 1000;
const SIGNATURE_HEADER_MAX_BYTES = 8 * 1024;
const PUBLIC_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

let cachedApplicationToken: CachedApplicationToken | null = null;
let applicationTokenPromise: Promise<string> | null = null;
const publicKeyCache = new Map<string, CachedPublicKey>();
const failedPublicKeyCache = new Map<string, number>();
const publicKeyLookups = new Map<string, Promise<string>>();
const publicKeyLookupTimestamps: number[] = [];
const publicKeyLookupTimestampsByScope = new Map<string, number[]>();

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
  lookupBudgetKey: string;
  signatureHeader: string | null;
}) {
  const header = parseSignatureHeader(input.signatureHeader);
  const publicKey = await getEbayPublicKey(header.kid, input.lookupBudgetKey);
  const verifier = crypto.createVerify("sha1");
  verifier.update(input.body);
  verifier.end();

  const signature = decodeBase64(header.signature);
  const valid = verifier.verify(publicKey, signature);
  if (!valid) {
    throw new EbayNotificationSignatureError("Firma eBay non valida.", "signature_invalid");
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

  if (Buffer.byteLength(signatureHeader) > SIGNATURE_HEADER_MAX_BYTES) {
    throw new EbayNotificationSignatureError(
      "Header X-EBAY-SIGNATURE troppo grande.",
      "signature_malformed",
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
  if (
    typeof header.kid !== "string" ||
    !PUBLIC_KEY_ID_PATTERN.test(header.kid) ||
    typeof header.signature !== "string" ||
    !header.signature ||
    header.signature.length > SIGNATURE_HEADER_MAX_BYTES
  ) {
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

async function getEbayPublicKey(publicKeyId: string, lookupBudgetKey: string) {
  const now = Date.now();
  for (const [keyId, expiresAt] of failedPublicKeyCache) {
    if (expiresAt <= now) failedPublicKeyCache.delete(keyId);
  }
  const cached = publicKeyCache.get(publicKeyId);
  if (cached && cached.expiresAt > now) {
    return cached.key;
  }

  const failedUntil = failedPublicKeyCache.get(publicKeyId) ?? 0;
  if (failedUntil > now) {
    throw new Error("Public key eBay non disponibile.");
  }

  const pendingLookup = publicKeyLookups.get(publicKeyId);
  if (pendingLookup) return pendingLookup;

  consumePublicKeyLookupBudget(lookupBudgetKey, now);

  const lookup = fetchEbayPublicKey(publicKeyId);
  publicKeyLookups.set(publicKeyId, lookup);

  try {
    return await lookup;
  } catch (error) {
    failedPublicKeyCache.set(publicKeyId, Date.now() + PUBLIC_KEY_FAILURE_CACHE_TTL_MS);
    throw error;
  } finally {
    publicKeyLookups.delete(publicKeyId);
  }
}

function consumePublicKeyLookupBudget(lookupBudgetKey: string, now: number) {
  while (
    publicKeyLookupTimestamps[0] &&
    publicKeyLookupTimestamps[0] <= now - PUBLIC_KEY_LOOKUP_WINDOW_MS
  ) {
    publicKeyLookupTimestamps.shift();
  }

  for (const [scope, timestamps] of publicKeyLookupTimestampsByScope) {
    while (timestamps[0] && timestamps[0] <= now - PUBLIC_KEY_LOOKUP_WINDOW_MS) {
      timestamps.shift();
    }
    if (timestamps.length === 0) publicKeyLookupTimestampsByScope.delete(scope);
  }

  const scope = lookupBudgetKey.trim().slice(0, 128) || "unattributed";
  const timestamps = publicKeyLookupTimestampsByScope.get(scope) ?? [];

  if (
    timestamps.length >= PUBLIC_KEY_LOOKUP_LIMIT ||
    publicKeyLookupTimestamps.length >= PUBLIC_KEY_GLOBAL_LOOKUP_LIMIT
  ) {
    throw new Error("Limite temporaneo lookup public key eBay raggiunto.");
  }

  timestamps.push(now);
  publicKeyLookupTimestamps.push(now);
  publicKeyLookupTimestampsByScope.set(scope, timestamps);
}

async function fetchEbayPublicKey(publicKeyId: string) {
  const token = await getEbayApplicationAccessToken();
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- il payload eBay viene letto prima di response.ok per distinguere la chiave mancante dall'errore del provider; lo status è verificato subito dopo.
  const response = await fetch(`${getPublicKeyBaseUrl()}/${encodeURIComponent(publicKeyId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
  });
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

  applicationTokenPromise ??= fetchEbayApplicationAccessToken();

  try {
    return await applicationTokenPromise;
  } finally {
    applicationTokenPromise = null;
  }
}

async function fetchEbayApplicationAccessToken() {
  // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- il payload eBay viene letto prima di response.ok per propagare error e error_description; lo status è verificato subito dopo.
  const response = await fetch(getEbayTokenUrl(), {
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: EBAY_APPLICATION_SCOPE,
    }),
    headers: {
      Authorization: `Basic ${getEbayBasicAuthHeader()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
  });
  const json = (await response.json()) as Partial<EbayApplicationTokenResponse> & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? "Application token eBay non ottenuto.");
  }

  cachedApplicationToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max((json.expires_in ?? 0) * 1000 - TOKEN_EXPIRY_SAFETY_MS, 0),
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

  return ["-----BEGIN PUBLIC KEY-----", ...lines, "-----END PUBLIC KEY-----"].join("\n");
}

function decodeBase64(value: string) {
  try {
    return Buffer.from(value, "base64");
  } catch {
    return Buffer.from(value, "base64url");
  }
}

function getPublicKeyBaseUrl() {
  return getEbayEnvironment() === "production"
    ? EBAY_PUBLIC_KEY_URLS.production
    : EBAY_PUBLIC_KEY_URLS.sandbox;
}
