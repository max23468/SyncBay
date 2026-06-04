export function buildEbayProductSnapshotPayload(input: {
  descriptionMode: string;
  imageUrls?: string[];
  issueCodes: string[];
  skuGenerated: boolean;
  status: string;
}) {
  return {
    descriptionMode: input.descriptionMode,
    imageUrls: normalizeImageUrls(input.imageUrls ?? []),
    issueCodes: input.issueCodes,
    skuGenerated: input.skuGenerated,
    status: input.status,
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
