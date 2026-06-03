export function isShopifyGraphqlThrottleResponse(input: {
  envelope: unknown;
  status: number;
}) {
  if (input.status === 429) return true;

  return getShopifyGraphqlErrors(input.envelope).some((error) => {
    const code = getObjectField(error.extensions, "code");
    const message = getObjectField(error, "message");

    return (
      String(code ?? "").toUpperCase() === "THROTTLED" ||
      String(message ?? "").toLowerCase().includes("throttled")
    );
  });
}

function getShopifyGraphqlErrors(envelope: unknown) {
  const errors = getObjectField(envelope, "errors");

  return Array.isArray(errors)
    ? errors.filter(
        (error): error is Record<string, unknown> =>
          Boolean(error) && typeof error === "object",
      )
    : [];
}

function getObjectField(input: unknown, key: string) {
  if (!input || typeof input !== "object") return undefined;

  return (input as Record<string, unknown>)[key];
}
