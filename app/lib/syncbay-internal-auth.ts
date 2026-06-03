import { timingSafeEqual } from "node:crypto";

export type InternalAppSecretVerificationResult =
  | { ok: true }
  | { ok: false; message: string; status: 401 | 503 };

export function verifyInternalAppSecret(input: {
  authorization?: string | null;
  expectedSecret?: string | null;
  headerSecret?: string | null;
}): InternalAppSecretVerificationResult {
  const expectedSecret = input.expectedSecret?.trim();

  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      message: "APP_SECRET non configurato.",
    };
  }

  const authorizationSecret = input.authorization
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  const providedSecret = authorizationSecret || input.headerSecret?.trim() || "";

  if (secureEqual(providedSecret, expectedSecret)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    message: "Non autorizzato.",
  };
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
