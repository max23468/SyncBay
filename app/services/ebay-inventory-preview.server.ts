import type { EbayConnection } from "@prisma/client";

import {
  buildImportPreview,
  getEmptyImportPreview,
  type ImportPreviewListingCandidate,
  type ImportPreviewResult,
} from "./import-preview.server";
import { EbayTokenError, getUsableEbayAccessToken } from "./ebay-token.server";

interface EbayInventoryItem {
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
  groupIds?: string[];
  inventoryItemGroupKeys?: string[];
  product?: {
    description?: string;
    imageUrls?: string[];
    title?: string;
  };
  sku?: string;
}

interface EbayInventoryItemsResponse {
  inventoryItems?: EbayInventoryItem[];
  size?: number;
  total?: number;
}

interface EbayOffer {
  availableQuantity?: number;
  listing?: {
    listingId?: string;
    listingStatus?: string;
  };
  listingDescription?: string;
  offerId?: string;
  pricingSummary?: {
    auctionStartPrice?: {
      value?: string;
    };
    price?: {
      value?: string;
    };
  };
  sku?: string;
}

interface EbayOffersResponse {
  offers?: EbayOffer[];
}

interface EbayErrorResponse {
  error?: string;
  error_description?: string;
  errors?: Array<{
    errorId?: number;
    message?: string;
  }>;
}

export interface EbayInventoryPreviewState {
  coverageNote: string;
  errorMessage: string | null;
  previewResult: ImportPreviewResult;
  readCount: number;
  source: "inventory_api";
  totalAvailable: number | null;
}

const EBAY_INVENTORY_URLS = {
  production: "https://api.ebay.com/sell/inventory/v1",
  sandbox: "https://api.sandbox.ebay.com/sell/inventory/v1",
};
const DEFAULT_PREVIEW_LIMIT = 50;
const MAX_PREVIEW_LIMIT = 100;
const OFFER_LOOKUP_CONCURRENCY = 4;
const INVENTORY_API_COVERAGE_NOTE =
  "Preview live da Inventory API eBay: copre gli inventory item con offer pubblicate. I listing storici creati da Seller Hub/UI richiedono ancora fallback Trading API.";

export async function getEbayInventoryImportPreview(
  connection: EbayConnection,
  options: { limit?: number } = {},
): Promise<EbayInventoryPreviewState> {
  try {
    const { accessToken } = await getUsableEbayAccessToken(connection);
    const limit = getPreviewLimit(options.limit);
    const inventoryPage = await fetchInventoryItems({
      accessToken,
      connection,
      limit,
    });
    const offerCandidates = await mapWithConcurrency(
      inventoryPage.inventoryItems,
      OFFER_LOOKUP_CONCURRENCY,
      async (item) =>
        getPublishedOfferCandidate({ accessToken, connection, item }),
    );
    const candidates = offerCandidates.filter(
      (candidate): candidate is ImportPreviewListingCandidate =>
        Boolean(candidate),
    );

    return {
      coverageNote: INVENTORY_API_COVERAGE_NOTE,
      errorMessage: null,
      previewResult: buildImportPreview(candidates, "live"),
      readCount: inventoryPage.inventoryItems.length,
      source: "inventory_api",
      totalAvailable: inventoryPage.total,
    };
  } catch (error) {
    return {
      coverageNote: INVENTORY_API_COVERAGE_NOTE,
      errorMessage: getPublicPreviewErrorMessage(error),
      previewResult: getEmptyImportPreview("live"),
      readCount: 0,
      source: "inventory_api",
      totalAvailable: null,
    };
  }
}

async function fetchInventoryItems(input: {
  accessToken: string;
  connection: EbayConnection;
  limit: number;
}) {
  const url = new URL(
    `${getInventoryBaseUrl(input.connection.environment)}/inventory_item`,
  );
  url.searchParams.set("limit", String(input.limit));
  url.searchParams.set("offset", "0");

  const response = await fetchEbayJson<EbayInventoryItemsResponse>(
    url,
    input.accessToken,
  );

  return {
    inventoryItems: response.inventoryItems ?? [],
    total: typeof response.total === "number" ? response.total : null,
  };
}

async function getPublishedOfferCandidate(input: {
  accessToken: string;
  connection: EbayConnection;
  item: EbayInventoryItem;
}): Promise<ImportPreviewListingCandidate | null> {
  const sku = normalizeText(input.item.sku);
  if (!sku) return null;

  const offer = await fetchPublishedOfferForSku({
    accessToken: input.accessToken,
    connection: input.connection,
    sku,
  });
  if (!offer) return null;

  return {
    descriptionHtml:
      normalizeText(offer.listingDescription) ??
      normalizeText(input.item.product?.description),
    imageUrls: input.item.product?.imageUrls ?? [],
    itemId: offer.listing?.listingId ?? offer.offerId ?? sku,
    priceAmount: getOfferPrice(offer),
    quantity: getOfferQuantity(offer, input.item),
    sku,
    title: normalizeText(input.item.product?.title),
    variantCount: hasInventoryGroups(input.item) ? 2 : 1,
  } satisfies ImportPreviewListingCandidate;
}

async function fetchPublishedOfferForSku(input: {
  accessToken: string;
  connection: EbayConnection;
  sku: string;
}) {
  const url = new URL(
    `${getInventoryBaseUrl(input.connection.environment)}/offer`,
  );
  url.searchParams.set("sku", input.sku);
  url.searchParams.set("marketplace_id", input.connection.marketplaceId);
  url.searchParams.set("limit", "100");
  url.searchParams.set("offset", "0");

  const response = await fetchEbayJson<EbayOffersResponse>(
    url,
    input.accessToken,
  );

  return (response.offers ?? []).find(isPublishedOffer) ?? null;
}

async function fetchEbayJson<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const json = (await response.json()) as T & EbayErrorResponse;

  if (!response.ok) {
    throw new EbayInventoryPreviewError(
      getEbayApiErrorMessage(json, response.status),
    );
  }

  return json;
}

class EbayInventoryPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayInventoryPreviewError";
  }
}

function isPublishedOffer(offer: EbayOffer) {
  const status = normalizeText(offer.listing?.listingStatus)?.toUpperCase();

  return Boolean(
    offer.listing?.listingId &&
    (!status || !["ENDED", "INACTIVE", "NOT_LISTED"].includes(status)),
  );
}

function getOfferPrice(offer: EbayOffer) {
  return parseMoneyValue(
    offer.pricingSummary?.price?.value ??
      offer.pricingSummary?.auctionStartPrice?.value,
  );
}

function getOfferQuantity(offer: EbayOffer, item: EbayInventoryItem) {
  if (Number.isInteger(offer.availableQuantity)) return offer.availableQuantity;

  const inventoryQuantity =
    item.availability?.shipToLocationAvailability?.quantity;
  return Number.isInteger(inventoryQuantity) ? inventoryQuantity : null;
}

function hasInventoryGroups(item: EbayInventoryItem) {
  return (
    (item.groupIds?.length ?? 0) > 0 ||
    (item.inventoryItemGroupKeys?.length ?? 0) > 0
  );
}

function getInventoryBaseUrl(environment: string) {
  return environment === "production"
    ? EBAY_INVENTORY_URLS.production
    : EBAY_INVENTORY_URLS.sandbox;
}

function getPreviewLimit(limit: number | undefined) {
  if (!Number.isInteger(limit)) return DEFAULT_PREVIEW_LIMIT;

  return Math.min(Math.max(Number(limit), 1), MAX_PREVIEW_LIMIT);
}

function parseMoneyValue(value: string | null | undefined) {
  if (!value) return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEbayApiErrorMessage(json: EbayErrorResponse, status: number) {
  const apiMessage =
    json.error_description ??
    json.errors?.map((error) => error.message).find(Boolean) ??
    json.error;

  return apiMessage
    ? `eBay Inventory API ha risposto con HTTP ${status}: ${apiMessage}.`
    : `eBay Inventory API ha risposto con HTTP ${status}.`;
}

function getPublicPreviewErrorMessage(error: unknown) {
  if (error instanceof EbayTokenError) return error.message;
  if (error instanceof EbayInventoryPreviewError) return error.message;
  if (error instanceof Error) return error.message;

  return "Lettura Inventory API eBay non riuscita.";
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input) => Promise<Output>,
) {
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  const runNext = (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;

    if (currentIndex >= items.length) {
      return Promise.resolve();
    }

    return mapper(items[currentIndex]).then((result) => {
      results[currentIndex] = result;
      return runNext();
    });
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}
