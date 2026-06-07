import type { Prisma } from "@prisma/client";

import type { ImportPreviewListingCandidate } from "../services/import-preview.server";

export function serializeIncrementalPreviewCandidate(
  candidate: ImportPreviewListingCandidate,
): Prisma.JsonObject {
  return {
    currency: candidate.currency ?? null,
    descriptionHtml: candidate.descriptionHtml ?? null,
    imageUrls: candidate.imageUrls ?? [],
    itemId: candidate.itemId,
    priceAmount: candidate.priceAmount ?? null,
    quantity: candidate.quantity ?? null,
    sku: candidate.sku ?? null,
    skuGenerated: candidate.skuGenerated ?? null,
    storeCategoryId: candidate.storeCategoryId ?? null,
    storeCategoryName: candidate.storeCategoryName ?? null,
    title: candidate.title ?? null,
    variantCount: candidate.variantCount ?? null,
  };
}

export function deserializeIncrementalPreviewCandidate(
  value: unknown,
): ImportPreviewListingCandidate | null {
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!object) return null;

  const itemId = typeof object.itemId === "string" ? object.itemId : null;
  if (!itemId) return null;

  return {
    currency: getNullableString(object.currency),
    descriptionHtml: getNullableString(object.descriptionHtml),
    imageUrls: Array.isArray(object.imageUrls)
      ? object.imageUrls.filter((url): url is string => typeof url === "string")
      : [],
    itemId,
    priceAmount: getNullableNumber(object.priceAmount),
    quantity: getNullableNumber(object.quantity),
    sku: getNullableString(object.sku),
    skuGenerated:
      typeof object.skuGenerated === "boolean" ? object.skuGenerated : false,
    storeCategoryId: getNullableString(object.storeCategoryId),
    storeCategoryName: getNullableString(object.storeCategoryName),
    title: getNullableString(object.title),
    variantCount: getNullableNumber(object.variantCount) ?? 1,
  };
}

function getNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
