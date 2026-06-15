import type { ShopifyCategoryProposal } from "./syncbay-shopify-category-mapping";

type SnapshotPayloadValue =
  | boolean
  | number
  | string
  | null
  | SnapshotPayloadValue[]
  | { [key: string]: SnapshotPayloadValue };

export type EbayProductSnapshotPayload = {
  [key: string]: SnapshotPayloadValue;
};

export function buildEbayProductSnapshotPayload(input: {
  categoryProposal?: ShopifyCategoryProposal | null;
  descriptionMode: string;
  ebayPrimaryCategoryId?: string | null;
  ebayPrimaryCategoryName?: string | null;
  ebayPrimaryCategoryPath?: string | null;
  imageUrls?: string[];
  issueCodes: string[];
  skuGenerated: boolean;
  status: string;
  storeCategoryId?: string | null;
  storeCategoryName?: string | null;
}): EbayProductSnapshotPayload {
  return {
    descriptionMode: input.descriptionMode,
    imageUrls: normalizeImageUrls(input.imageUrls ?? []),
    issueCodes: input.issueCodes,
    skuGenerated: input.skuGenerated,
    status: input.status,
    ...(input.ebayPrimaryCategoryId
      ? { ebayPrimaryCategoryId: input.ebayPrimaryCategoryId }
      : {}),
    ...(input.ebayPrimaryCategoryName
      ? { ebayPrimaryCategoryName: input.ebayPrimaryCategoryName }
      : {}),
    ...(input.ebayPrimaryCategoryPath
      ? { ebayPrimaryCategoryPath: input.ebayPrimaryCategoryPath }
      : {}),
    ...(input.storeCategoryId
      ? { storeCategoryId: input.storeCategoryId }
      : {}),
    ...(input.storeCategoryName
      ? { storeCategoryName: input.storeCategoryName }
      : {}),
    ...(input.categoryProposal
      ? { categoryProposal: serializeCategoryProposal(input.categoryProposal) }
      : {}),
  };
}

function serializeCategoryProposal(
  proposal: ShopifyCategoryProposal,
): EbayProductSnapshotPayload {
  return {
    applied: proposal.applied,
    confidence: proposal.confidence,
    productType: proposal.productType,
    reason: proposal.reason,
    shopifyCategoryGid: proposal.shopifyCategoryGid,
    shopifyCategoryName: proposal.shopifyCategoryName,
    source: proposal.source,
  };
}

export function getProductSnapshotThumbnailUrl(value: unknown) {
  const payload = getObject(value);
  const mediaSync = getObject(payload?.mediaSync);
  const imageUrls = [
    ...getStringArray(payload?.imageUrls),
    ...getStringArray(mediaSync?.sourceImageUrls),
  ];
  const firstImageUrl = imageUrls.find(isSafeImageUrl);
  const directImageUrl = [
    payload?.imageUrl,
    payload?.thumbnailUrl,
    payload?.galleryUrl,
    payload?.GalleryURL,
  ]
    .map(getString)
    .find((url): url is string => Boolean(url && isSafeImageUrl(url)));

  return firstImageUrl ?? directImageUrl ?? null;
}

export function getProductSnapshotThumbnailUrlFromPayloads(values: unknown[]) {
  for (const value of values) {
    const thumbnailUrl = getProductSnapshotThumbnailUrl(value);

    if (thumbnailUrl) return thumbnailUrl;
  }

  return null;
}

function normalizeImageUrls(imageUrls: string[]) {
  return [...new Set(imageUrls.map((imageUrl) => imageUrl.trim()))].filter(
    Boolean,
  );
}

function getObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isSafeImageUrl(value: string) {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
