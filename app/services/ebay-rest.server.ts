const DEFAULT_EBAY_REST_TIMEOUT_MS = 10 * 1000;

interface EbayRestErrorPayload {
  error?: string;
  error_description?: string;
  errors?: Array<{
    longMessage?: string;
    message?: string;
  }>;
}

export async function requestEbayRestJson<T = unknown>(input: {
  accessToken: string;
  headers?: HeadersInit;
  operation: string;
  signal?: AbortSignal;
  url: URL;
}): Promise<T> {
  const headers = new Headers(input.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${input.accessToken}`);
  const signal = input.signal ?? AbortSignal.timeout(DEFAULT_EBAY_REST_TIMEOUT_MS);

  let response: Response;
  try {
    // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- il payload JSON contiene l'errore provider; lo status è verificato subito dopo il parsing.
    response = await fetch(input.url, {
      headers,
      signal,
    });
  } catch (cause) {
    throw new Error(
      isTimeoutError(cause, signal)
        ? `${input.operation}: timeout durante la richiesta eBay.`
        : `${input.operation}: errore di rete.`,
      { cause },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new Error(
      isTimeoutError(cause, signal)
        ? `${input.operation}: timeout durante la richiesta eBay.`
        : `${input.operation}: risposta JSON non valida (HTTP ${response.status}).`,
      { cause },
    );
  }

  if (!response.ok) {
    const payload = json as EbayRestErrorPayload;
    const firstError = payload?.errors?.[0];
    const providerMessage =
      payload?.error_description ??
      firstError?.longMessage ??
      firstError?.message ??
      payload?.error;

    throw new Error(
      providerMessage
        ? `${input.operation} ha risposto con HTTP ${response.status}: ${providerMessage}`
        : `${input.operation} ha risposto con HTTP ${response.status}.`,
    );
  }

  return json as T;
}

function isTimeoutError(error: unknown, signal: AbortSignal) {
  return [error, signal.reason].some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "name" in value &&
      value.name === "TimeoutError",
  );
}
