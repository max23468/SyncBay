const DEFAULT_FORM_BODY_LIMIT_BYTES = 256 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Payload HTTP troppo grande.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readRequestBodyWithLimit(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export async function parseFormDataWithLimit(
  request: Request,
  maxBytes = DEFAULT_FORM_BODY_LIMIT_BYTES,
) {
  const body = await readRequestBodyWithLimit(request, maxBytes);

  return new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
