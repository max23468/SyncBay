import { getEbayBasicAuthHeader, getEbayTokenUrl } from "./ebay-environment.server.ts";

type EbayOAuthGrant =
  | { code: string; redirectUri: string; type: "authorization_code" }
  | { refreshToken: string; scope?: string | null; type: "refresh_token" }
  | { scope: string; type: "client_credentials" };

interface EbayOAuthWireResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

export class EbayOAuthRequestError extends Error {
  readonly code?: string;
  readonly status: number | null;

  constructor(message: string, status: number | null, code?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EbayOAuthRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function requestEbayOAuthToken(input: {
  environment?: string | null;
  grant: EbayOAuthGrant;
  signal?: AbortSignal;
}) {
  let response: Response;

  try {
    // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- il payload OAuth contiene l'errore provider; lo status è verificato subito dopo il parsing.
    response = await fetch(getEbayTokenUrl(input.environment), {
      body: buildGrantBody(input.grant),
      headers: {
        Authorization: `Basic ${getEbayBasicAuthHeader()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal: input.signal,
    });
  } catch (cause) {
    throw new EbayOAuthRequestError(
      "Errore di rete durante la richiesta token eBay.",
      null,
      undefined,
      {
        cause,
      },
    );
  }

  let json: EbayOAuthWireResponse;
  try {
    json = (await response.json()) as EbayOAuthWireResponse;
  } catch (cause) {
    throw new EbayOAuthRequestError(
      `Risposta token eBay non valida (HTTP ${response.status}).`,
      response.status,
      undefined,
      { cause },
    );
  }

  if (!response.ok || !json.access_token) {
    throw new EbayOAuthRequestError(
      json.error_description ??
        json.error ??
        `Token OAuth eBay non ottenuto (HTTP ${response.status}).`,
      response.status,
      json.error,
    );
  }

  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
    refreshToken: json.refresh_token,
    refreshTokenExpiresIn: json.refresh_token_expires_in,
    scope: json.scope,
  };
}

function buildGrantBody(grant: EbayOAuthGrant) {
  if (grant.type === "authorization_code") {
    return new URLSearchParams({
      code: grant.code,
      grant_type: grant.type,
      redirect_uri: grant.redirectUri,
    });
  }

  if (grant.type === "client_credentials") {
    return new URLSearchParams({ grant_type: grant.type, scope: grant.scope });
  }

  const body = new URLSearchParams({
    grant_type: grant.type,
    refresh_token: grant.refreshToken,
  });
  if (grant.scope?.trim()) body.set("scope", grant.scope.trim());

  return body;
}
