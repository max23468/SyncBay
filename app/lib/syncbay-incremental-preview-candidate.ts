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
    itemSpecifics: serializeItemSpecifics(candidate.itemSpecifics ?? []),
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
    itemSpecifics: deserializeItemSpecifics(object.itemSpecifics),
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

function serializeItemSpecifics(
  itemSpecifics: NonNullable<ImportPreviewListingCandidate["itemSpecifics"]>,
) {
  return itemSpecifics.flatMap((specific) => {
    const name = specific.name.trim();
    const values = specific.values.flatMap((value) => {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    });
    if (!name || values.length === 0) return [];

    return [{ name, values }];
  });
}

function deserializeItemSpecifics(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const object =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : null;
    const name = getNullableString(object?.name)?.trim();
    const values = Array.isArray(object?.values)
      ? object.values.flatMap((entry) => {
          if (typeof entry !== "string") return [];
          const trimmed = entry.trim();
          return trimmed ? [trimmed] : [];
        })
      : [];
    if (!name || values.length === 0) return [];

    return [{ name, values }];
  });
}

function getNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
