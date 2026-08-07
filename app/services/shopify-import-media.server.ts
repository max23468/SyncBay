import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { mapWithConcurrency } from "../lib/map-with-concurrency";
import {
  getShopifyImageMediaIds,
  shouldSyncExistingCatalogImages,
} from "../lib/syncbay-existing-catalog-field-policy";

import {
  ShopifyAdminGraphqlClient,
  ShopifyCreatedProduct,
  ShopifyDraftProductInput,
  ShopifyDraftProductNode,
  ShopifyMediaSyncResult,
  ShopifyProductUpdateResponse,
  ShopifyUserError,
  formatShopifyGraphqlErrors,
  formatShopifyUserErrors,
} from "./shopify-import-shared.server";

interface ShopifyProductDeleteMediaResponse {
  data?: {
    productDeleteMedia?: {
      deletedMediaIds?: string[];
      deletedProductImageIds?: string[];
      mediaUserErrors?: ShopifyUserError[];
      product?: ShopifyDraftProductNode | null;
    };
  };
  errors?: Array<{
    message: string;
  }>;
}

const SHOPIFY_MEDIA_SYNC_CONCURRENCY = 2;

const SUPABASE_SIGNED_URL_TTL_SECONDS = 604_800;

const IMAGE_DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_DOWNLOAD_TIMEOUT_MS = 15 * 1000;

const IMAGE_DOWNLOAD_MAX_REDIRECTS = 3;

const NON_PUBLIC_IMAGE_ADDRESSES = buildNonPublicImageAddressBlockList();

type LookupHost = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

type PublicImageTarget = {
  addresses: Array<{ address: string; family: 4 | 6 }>;
  url: URL;
};

type RequestPublicImage = (target: PublicImageTarget) => Promise<Response>;

export async function syncShopifyMediaFromEbayImages(
  admin: ShopifyAdminGraphqlClient,
  product: NonNullable<ShopifyCreatedProduct>,
  draftProduct: ShopifyDraftProductInput,
  context: {
    jobId: string;
  },
): Promise<ShopifyMediaSyncResult> {
  const existingImageMediaIds = getProductImageMediaIds(product);
  const sourceMedia = draftProduct.media;
  const stagedObjectPaths: string[] = [];
  const failedResults: ShopifyMediaSyncResult["failedResults"] = [];
  let directCreatedCount = 0;
  let stagedCreatedCount = 0;
  let deletedCount = 0;

  if (
    !shouldSyncExistingCatalogImages({
      currentImageCount: existingImageMediaIds.length,
      fieldPolicy: draftProduct.existingCatalogFieldPolicy,
    })
  ) {
    return {
      createdCount: 0,
      deletedCount: 0,
      directCreatedCount: 0,
      failedResults: [],
      preservedCount: existingImageMediaIds.length,
      requestedCount: 0,
      sourceImageUrls: [],
      stagedCreatedCount: 0,
      stagedObjectPaths,
      status: "synced",
    };
  }

  if (existingImageMediaIds.length > 0 && sourceMedia.length > 0) {
    const deleteResult = await deleteShopifyProductMediaFiles(
      admin,
      product.id,
      existingImageMediaIds,
    );

    if (deleteResult.status === "failed") {
      return {
        createdCount: 0,
        deletedCount: 0,
        directCreatedCount: 0,
        failedResults: [
          {
            errorMessage: deleteResult.errorMessage,
            index: -1,
            sourceUrl: "",
          },
        ],
        // La cancellazione è fallita: le immagini esistenti restano sul prodotto.
        preservedCount: existingImageMediaIds.length,
        requestedCount: sourceMedia.length,
        sourceImageUrls: sourceMedia.map((media) => media.originalSource),
        stagedCreatedCount: 0,
        stagedObjectPaths,
        status: "failed",
      };
    }

    deletedCount = deleteResult.deletedCount;
  }

  const mediaResults = await mapWithConcurrency(
    sourceMedia.map((media, index) => ({ index, media })),
    SHOPIFY_MEDIA_SYNC_CONCURRENCY,
    async ({ index, media }) => {
      const directResult = await addShopifyProductMedia(admin, {
        media,
        productGid: product.id,
      });

      if (directResult.status === "synced") {
        return { mode: "direct" as const, status: "synced" as const };
      }

      const stagedResult = await createStagedImageMediaInput({
        ebayItemId: draftProduct.source.ebayItemId,
        index,
        jobId: context.jobId,
        media,
      });

      if (stagedResult.status === "failed") {
        return {
          errorMessage: `${directResult.errorMessage}; fallback Supabase non riuscito: ${stagedResult.errorMessage}`,
          index,
          sourceUrl: media.originalSource,
          status: "failed" as const,
        };
      }

      const stagedMediaResult = await addShopifyProductMedia(admin, {
        media: stagedResult.media,
        productGid: product.id,
      });

      if (stagedMediaResult.status === "failed") {
        return {
          errorMessage: `${directResult.errorMessage}; fallback Supabase caricato ma rifiutato da Shopify: ${stagedMediaResult.errorMessage}`,
          index,
          sourceUrl: media.originalSource,
          status: "failed" as const,
        };
      }

      return {
        mode: "staged" as const,
        objectPath: stagedResult.objectPath,
        status: "synced" as const,
      };
    },
  );

  for (const result of mediaResults) {
    if (result.status === "failed") {
      failedResults.push({
        errorMessage: result.errorMessage,
        index: result.index,
        sourceUrl: result.sourceUrl,
      });
      continue;
    }

    if (result.mode === "direct") {
      directCreatedCount += 1;
      continue;
    }

    stagedCreatedCount += 1;
    stagedObjectPaths.push(result.objectPath);
  }

  const createdCount = directCreatedCount + stagedCreatedCount;

  return {
    createdCount,
    deletedCount,
    directCreatedCount,
    failedResults,
    // Immagini già presenti su Shopify e non cancellate in questa run: senza
    // conteggiarle, una sync con `sourceMedia` vuota (es. eBay che non
    // restituisce immagini in quella lettura) registrerebbe `imageCount` 0 pur
    // avendo il prodotto ancora le sue immagini, aprendo un falso conflitto
    // `images`. `imageCount` deve riflettere le immagini reali sul prodotto,
    // non quelle toccate dalla run.
    preservedCount: existingImageMediaIds.length - deletedCount,
    requestedCount: sourceMedia.length,
    sourceImageUrls: sourceMedia.map((media) => media.originalSource),
    stagedCreatedCount,
    stagedObjectPaths,
    status: failedResults.length > 0 ? "failed" : "synced",
  };
}

async function addShopifyProductMedia(
  admin: ShopifyAdminGraphqlClient,
  input: {
    media: ShopifyDraftProductInput["media"][number];
    productGid: string;
  },
): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await admin.graphql(
    `#graphql
    mutation SyncBayAddProductMedia($media: [CreateMediaInput!], $product: ProductUpdateInput!) {
      productUpdate(media: $media, product: $product) {
        product {
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        media: [input.media],
        product: {
          id: input.productGid,
        },
      },
    },
  );
  const json = (await response.json()) as ShopifyProductUpdateResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productUpdate media ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function deleteShopifyProductMediaFiles(
  admin: ShopifyAdminGraphqlClient,
  productGid: string,
  mediaIds: string[],
): Promise<
  { deletedCount: number; status: "synced" } | { errorMessage: string; status: "failed" }
> {
  const uniqueMediaIds = [...new Set(mediaIds)];

  if (uniqueMediaIds.length === 0) {
    return {
      deletedCount: 0,
      status: "synced",
    };
  }

  const response = await admin.graphql(
    `#graphql
    mutation SyncBayDeleteProductMediaFiles($mediaIds: [ID!]!, $productId: ID!) {
      productDeleteMedia(mediaIds: $mediaIds, productId: $productId) {
        deletedMediaIds
        deletedProductImageIds
        product {
          id
          media(first: 250) {
            nodes {
              alt
              id
              mediaContentType
              preview {
                status
              }
            }
          }
        }
        mediaUserErrors {
          code
          field
          message
        }
      }
    }`,
    {
      variables: {
        mediaIds: uniqueMediaIds,
        productId: productGid,
      },
    },
  );
  const json = (await response.json()) as ShopifyProductDeleteMediaResponse;

  if (!response.ok) {
    return {
      errorMessage: `Shopify productDeleteMedia ha risposto con stato HTTP ${response.status}.`,
      status: "failed",
    };
  }

  if (json.errors?.length) {
    return {
      errorMessage: formatShopifyGraphqlErrors(json.errors),
      status: "failed",
    };
  }

  const userErrors = json.data?.productDeleteMedia?.mediaUserErrors ?? [];

  if (userErrors.length > 0) {
    return {
      errorMessage: formatShopifyUserErrors(userErrors),
      status: "failed",
    };
  }

  return {
    deletedCount:
      json.data?.productDeleteMedia?.deletedMediaIds?.length ??
      json.data?.productDeleteMedia?.deletedProductImageIds?.length ??
      uniqueMediaIds.length,
    status: "synced",
  };
}

async function createStagedImageMediaInput(input: {
  ebayItemId: string;
  index: number;
  jobId: string;
  media: ShopifyDraftProductInput["media"][number];
}): Promise<
  | {
      media: ShopifyDraftProductInput["media"][number];
      objectPath: string;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const config = getSupabaseStorageConfig();

  if (!config) {
    return {
      errorMessage: "Supabase Storage fallback non configurato nel runtime server.",
      status: "failed",
    };
  }

  const imageResult = await downloadImageForStaging(input.media.originalSource);

  if (imageResult.status === "failed") {
    return imageResult;
  }

  const objectPath = buildSupabaseImageObjectPath({
    contentType: imageResult.contentType,
    ebayItemId: input.ebayItemId,
    index: input.index,
    jobId: input.jobId,
    sourceUrl: input.media.originalSource,
  });
  const uploadResult = await uploadSupabaseStorageObject({
    body: imageResult.body,
    bucket: config.bucket,
    contentType: imageResult.contentType,
    objectPath,
    serviceRoleKey: config.serviceRoleKey,
    supabaseUrl: config.supabaseUrl,
  });

  if (uploadResult.status === "failed") {
    return uploadResult;
  }

  const signedUrlResult = await createSupabaseSignedUrl({
    bucket: config.bucket,
    objectPath,
    serviceRoleKey: config.serviceRoleKey,
    supabaseUrl: config.supabaseUrl,
  });

  if (signedUrlResult.status === "failed") {
    return signedUrlResult;
  }

  return {
    media: {
      ...input.media,
      originalSource: signedUrlResult.signedUrl,
    },
    objectPath,
    status: "synced",
  };
}

export async function downloadImageForStaging(
  sourceUrl: string,
  options: {
    lookupHost?: LookupHost;
    maxBytes?: number;
    requestImpl?: RequestPublicImage;
  } = {},
): Promise<
  | {
      body: Uint8Array;
      contentType: string;
      status: "synced";
    }
  | {
      errorMessage: string;
      status: "failed";
    }
> {
  const maxBytes = options.maxBytes ?? IMAGE_DOWNLOAD_MAX_BYTES;
  let response: Response;

  try {
    response = await fetchPublicImage(sourceUrl, {
      lookupHost: options.lookupHost ?? lookup,
      requestImpl: options.requestImpl ?? requestPublicImage,
    });
  } catch {
    return {
      errorMessage: "URL immagine eBay non raggiungibile in modo sicuro.",
      status: "failed",
    };
  }

  if (!response.ok) {
    return {
      errorMessage: `Download immagine eBay fallito con HTTP ${response.status}.`,
      status: "failed",
    };
  }

  const contentType = normalizeImageContentType(response.headers.get("content-type"), sourceUrl);

  if (!contentType) {
    return {
      errorMessage: "Il download immagine non ha restituito un content-type immagine supportato.",
      status: "failed",
    };
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    return {
      errorMessage: "Il download immagine supera il limite consentito.",
      status: "failed",
    };
  }

  let body: Uint8Array | null;
  try {
    body = await readImageBodyWithLimit(response, maxBytes);
  } catch {
    return {
      errorMessage: "Download immagine eBay interrotto.",
      status: "failed",
    };
  }
  if (!body) {
    return {
      errorMessage: "Il download immagine supera il limite consentito.",
      status: "failed",
    };
  }

  if (body.byteLength === 0) {
    return {
      errorMessage: "Il download immagine ha restituito un file vuoto.",
      status: "failed",
    };
  }

  return {
    body,
    contentType,
    status: "synced",
  };
}

async function fetchPublicImage(
  sourceUrl: string,
  options: {
    lookupHost: LookupHost;
    requestImpl: RequestPublicImage;
  },
  redirectCount = 0,
): Promise<Response> {
  const target = await validatePublicImageUrl(sourceUrl, options.lookupHost);
  const response = await options.requestImpl(target);

  if (![301, 302, 303, 307, 308].includes(response.status)) return response;

  const location = response.headers.get("location");
  await response.body?.cancel();
  if (!location || redirectCount >= IMAGE_DOWNLOAD_MAX_REDIRECTS) {
    throw new Error("Redirect immagine non valido.");
  }

  return fetchPublicImage(new URL(location, target.url).toString(), options, redirectCount + 1);
}

async function validatePublicImageUrl(sourceUrl: string, lookupHost: LookupHost) {
  const url = new URL(sourceUrl);

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("URL immagine non sicuro.");
  }

  const literalVersion = isIP(url.hostname);
  const addresses = literalVersion
    ? [{ address: url.hostname, family: literalVersion }]
    : await lookupHost(url.hostname, { all: true, verbatim: true });

  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      NON_PUBLIC_IMAGE_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4"),
    )
  ) {
    throw new Error("Destinazione immagine non pubblica.");
  }

  return {
    addresses: addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })),
    url,
  } satisfies PublicImageTarget;
}

function requestPublicImage({ addresses, url }: PublicImageTarget) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: { "user-agent": "SyncBay/0.1 image-staging" },
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, addresses);
            return;
          }
          const { address, family } = addresses[0];
          callback(null, address, family);
        },
        signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
      },
      (response) => {
        try {
          const status = response.statusCode ?? 500;
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }

          resolve(
            new Response(
              [204, 205, 304].includes(status)
                ? null
                : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
              {
                headers,
                status,
                statusText: response.statusMessage,
              },
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function readImageBodyWithLimit(response: Response, maxBytes: number) {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      return null;
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

function buildNonPublicImageAddressBlockList() {
  const blockList = new BlockList();
  const ipv4Subnets = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const;
  const ipv6Subnets = [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
    ["2001:db8::", 32],
  ] as const;

  for (const [address, prefix] of ipv4Subnets) blockList.addSubnet(address, prefix, "ipv4");
  for (const [address, prefix] of ipv6Subnets) blockList.addSubnet(address, prefix, "ipv6");

  return blockList;
}

async function uploadSupabaseStorageObject(input: {
  body: Uint8Array;
  bucket: string;
  contentType: string;
  objectPath: string;
  serviceRoleKey: string;
  supabaseUrl: string;
}): Promise<{ status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await fetch(
    `${input.supabaseUrl}/storage/v1/object/${encodeURIComponent(input.bucket)}/${encodeSupabaseObjectPath(input.objectPath)}`,
    {
      body: Buffer.from(input.body),
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        "cache-control": "31536000",
        "content-type": input.contentType,
        "x-upsert": "true",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Upload Supabase Storage fallito con HTTP ${response.status}: ${await readShortResponseText(response)}`,
      status: "failed",
    };
  }

  return { status: "synced" };
}

async function createSupabaseSignedUrl(input: {
  bucket: string;
  objectPath: string;
  serviceRoleKey: string;
  supabaseUrl: string;
}): Promise<{ signedUrl: string; status: "synced" } | { errorMessage: string; status: "failed" }> {
  const response = await fetch(
    `${input.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(input.bucket)}/${encodeSupabaseObjectPath(input.objectPath)}`,
    {
      body: JSON.stringify({
        expiresIn: SUPABASE_SIGNED_URL_TTL_SECONDS,
      }),
      headers: {
        apikey: input.serviceRoleKey,
        authorization: `Bearer ${input.serviceRoleKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    return {
      errorMessage: `Creazione signed URL Supabase fallita con HTTP ${response.status}: ${await readShortResponseText(response)}`,
      status: "failed",
    };
  }

  const json = (await response.json()) as { signedURL?: string };
  const signedUrl = json.signedURL;

  if (!signedUrl) {
    return {
      errorMessage: "Supabase Storage non ha restituito una signed URL.",
      status: "failed",
    };
  }

  return {
    signedUrl: signedUrl.startsWith("http")
      ? signedUrl
      : `${input.supabaseUrl}/storage/v1${signedUrl}`,
    status: "synced",
  };
}

function getProductImageMediaIds(product: ShopifyDraftProductNode) {
  return getShopifyImageMediaIds(product.media?.nodes);
}

function getSupabaseStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() ?? "syncbay-import-staging";

  if (!supabaseUrl || !serviceRoleKey || !bucket) return null;

  return {
    bucket,
    serviceRoleKey,
    supabaseUrl,
  };
}

function buildSupabaseImageObjectPath(input: {
  contentType: string;
  ebayItemId: string;
  index: number;
  jobId: string;
  sourceUrl: string;
}) {
  const hash = createHash("sha256").update(input.sourceUrl).digest("hex").slice(0, 16);
  const extension = getImageExtension(input.contentType, input.sourceUrl);

  return [
    "imports",
    sanitizeStoragePathSegment(input.jobId),
    sanitizeStoragePathSegment(input.ebayItemId),
    `${String(input.index + 1).padStart(3, "0")}-${hash}.${extension}`,
  ].join("/");
}

function sanitizeStoragePathSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodeSupabaseObjectPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeImageContentType(rawContentType: string | null, sourceUrl: string) {
  const contentType = rawContentType?.split(";")[0]?.trim().toLowerCase();

  if (contentType?.startsWith("image/")) return contentType;

  const extension = sourceUrl.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";

  return null;
}

function getImageExtension(contentType: string, sourceUrl: string) {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";

  return (
    sourceUrl
      .split("?")[0]
      .split("#")[0]
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "jpg"
  );
}

async function readShortResponseText(response: Response) {
  const text = await response.text();

  return text.slice(0, 300);
}
