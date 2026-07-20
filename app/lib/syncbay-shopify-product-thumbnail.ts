import { isSafeHttpUrl } from "./safe-http-url";

export function getShopifyProductThumbnailUrl(value: unknown) {
  const product = getObject(value);
  const media = getObject(product?.media);
  const nodes = Array.isArray(media?.nodes) ? media.nodes : [];

  for (const node of nodes) {
    const mediaNode = getObject(node);

    if (mediaNode?.mediaContentType !== "IMAGE") continue;

    const preview = getObject(mediaNode.preview);
    const previewStatus = getString(preview?.status);

    if (previewStatus && previewStatus !== "READY") continue;

    const image = getObject(mediaNode.image);
    const previewImage = getObject(preview?.image);

    for (const candidate of [getString(image?.url), getString(previewImage?.url)]) {
      if (candidate && isSafeHttpUrl(candidate)) return candidate;
    }
  }

  return null;
}

function getObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null;
}
