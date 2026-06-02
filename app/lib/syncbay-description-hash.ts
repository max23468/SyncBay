import { createHash } from "node:crypto";

export function hashNullableText(value: string | null | undefined) {
  if (!value) return null;

  return createHash("sha256").update(value).digest("hex");
}

export function getSyncBayDescriptionHash(input: {
  fallbackDescriptionHtml: string | null | undefined;
  shopifyDescriptionHtml?: string | null;
}) {
  if (input.shopifyDescriptionHtml !== undefined) {
    return hashNullableText(input.shopifyDescriptionHtml);
  }

  return hashNullableText(input.fallbackDescriptionHtml);
}
