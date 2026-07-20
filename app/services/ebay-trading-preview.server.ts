import type { EbayConnection } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";

import { mapWithConcurrency } from "../lib/map-with-concurrency";
import { getEbayStorefrontMetadata } from "../lib/syncbay-ebay-storefront";
import { buildExistingCatalogPreviewMetadata } from "../lib/syncbay-existing-catalog-preview";
import { parseEbayTradingItemSpecifics } from "../lib/syncbay-product-facets";
import { getExpectedMarketplaceCurrency } from "../lib/syncbay-stock-guard";
import type { DescriptionRuleMode } from "../lib/syncbay-description-rules";
import { buildImportPreview, type ImportPreviewListingCandidate } from "./import-preview.server";

interface EbayTradingPreviewInput {
  accessToken: string;
  connection: EbayConnection;
  limit: number;
}

type EbayTradingRequestContext = Pick<EbayTradingPreviewInput, "accessToken" | "connection">;

export interface EbayTradingPreviewPage {
  candidates: ImportPreviewListingCandidate[];
  readCount: number;
  totalAvailable: number | null;
}

export interface EbayTradingCatalogImportPlan {
  itemIds: string[];
  readCount: number;
  totalAvailable: number | null;
}

export interface EbayTradingCatalogImportPreview {
  previewResult: ReturnType<typeof buildImportPreview>;
  readCount: number;
  totalAvailable: number | null;
  totalPlanned: number;
  truncatedAtMaxProducts: boolean;
}

export interface EbayTradingSellerEventsDelta {
  candidates: ImportPreviewListingCandidate[];
  inactiveItemIds: string[];
  readCount: number;
  timeFrom: string;
  timeTo: string;
  truncated: boolean;
}

type XmlRecord = Record<string, unknown>;

const EBAY_TRADING_URLS = {
  production: "https://api.ebay.com/ws/api.dll",
  sandbox: "https://api.sandbox.ebay.com/ws/api.dll",
};
const EBAY_TRADING_SITE_IDS: Record<string, string> = {
  EBAY_IT: "101",
};
const TRADING_API_COMPATIBILITY_LEVEL = "1453";
const TRADING_API_ERROR_LANGUAGE = "it_IT";
const TRADING_API_MAX_ENTRIES_PER_PAGE = 200;
const GET_ITEM_DETAIL_LOOKUP_LIMIT = 10;
const GET_ITEM_LOOKUP_CONCURRENCY = 4;
const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

export async function getEbayTradingImportPreview(
  input: EbayTradingPreviewInput,
): Promise<EbayTradingPreviewPage> {
  const xml = buildGetMyeBaySellingRequest({
    entriesPerPage: input.limit,
    pageNumber: 1,
  });
  const body = await fetchTradingXml({
    accessToken: input.accessToken,
    callName: "GetMyeBaySelling",
    connection: input.connection,
    requestXml: xml,
  });
  const activeList = asRecord(body.ActiveList);
  const items = getTradingItems(activeList);
  const candidates = await mapWithConcurrency(
    items,
    GET_ITEM_LOOKUP_CONCURRENCY,
    async (item, index) => {
      if (index >= GET_ITEM_DETAIL_LOOKUP_LIMIT) {
        const listCandidate = mapTradingItemToCandidate(item, input.connection.marketplaceId);
        return listCandidate ? withFallbackSku(listCandidate) : null;
      }

      return getEnrichedTradingCandidate(input, item);
    },
  );

  return {
    candidates: candidates.filter((candidate): candidate is ImportPreviewListingCandidate =>
      Boolean(candidate),
    ),
    readCount: items.length,
    totalAvailable: getTotalEntries(activeList),
  };
}

export async function getEbayTradingCatalogImportPreview(input: {
  accessToken: string;
  connection: EbayConnection;
  descriptionRuleMode?: DescriptionRuleMode;
  maxProducts: number;
}): Promise<EbayTradingCatalogImportPreview> {
  const catalogPreview = await getEbayTradingCatalogPreviewCandidates({
    accessToken: input.accessToken,
    connection: input.connection,
    maxProducts: input.maxProducts,
  });
  const metadata = buildExistingCatalogPreviewMetadata({
    maxProducts: input.maxProducts,
    readCount: catalogPreview.readCount,
    totalAvailable: catalogPreview.totalAvailable,
    totalPlanned: catalogPreview.totalPlanned,
  });

  return {
    previewResult: buildImportPreview(catalogPreview.candidates, "live", {
      descriptionRuleMode: input.descriptionRuleMode,
    }),
    ...metadata,
  };
}

async function getEbayTradingCatalogPreviewCandidates(input: {
  accessToken: string;
  connection: EbayConnection;
  maxProducts: number;
}) {
  const maxProducts = normalizePositiveInteger(input.maxProducts);
  const entriesPerPage = Math.min(maxProducts, TRADING_API_MAX_ENTRIES_PER_PAGE);
  const candidates: ImportPreviewListingCandidate[] = [];
  const seenItemIds = new Set<string>();
  let pageNumber = 1;
  let readCount = 0;
  let totalAvailable: number | null = null;
  let totalPages: number | null = null;
  let totalPlanned = 0;

  while (totalPlanned < maxProducts) {
    if (totalPages !== null && pageNumber > totalPages) break;

    const xml = buildGetMyeBaySellingRequest({
      entriesPerPage,
      pageNumber,
    });
    const body = await fetchTradingXml({
      accessToken: input.accessToken,
      callName: "GetMyeBaySelling",
      connection: input.connection,
      requestXml: xml,
    });
    const activeList = asRecord(body.ActiveList);
    const items = getTradingItems(activeList);
    const previewItems: Array<{ index: number; item: XmlRecord }> = [];

    readCount += items.length;
    totalAvailable ??= getTotalEntries(activeList);
    totalPages ??= getTotalPages(activeList);

    for (const item of items) {
      const itemId = getString(item, "ItemID");
      if (!itemId || seenItemIds.has(itemId)) continue;

      seenItemIds.add(itemId);
      previewItems.push({ index: totalPlanned, item });
      totalPlanned += 1;

      if (totalPlanned >= maxProducts) break;
    }

    const pageCandidates = await mapWithConcurrency(
      previewItems,
      GET_ITEM_LOOKUP_CONCURRENCY,
      async ({ index, item }) => {
        if (index < GET_ITEM_DETAIL_LOOKUP_LIMIT) {
          return getEnrichedTradingCandidate(input, item);
        }

        const listCandidate = mapTradingItemToCandidate(item, input.connection.marketplaceId);
        return listCandidate ? withFallbackSku(listCandidate) : null;
      },
    );
    candidates.push(
      ...pageCandidates.filter((candidate): candidate is ImportPreviewListingCandidate =>
        Boolean(candidate),
      ),
    );

    if (items.length === 0) break;
    if (totalAvailable !== null && readCount >= totalAvailable) break;
    if (items.length < entriesPerPage && totalPages === null) break;

    pageNumber += 1;
  }

  return {
    candidates,
    readCount,
    totalAvailable,
    totalPlanned,
  };
}

export async function getEbayTradingCatalogImportPlan(input: {
  accessToken: string;
  connection: EbayConnection;
  maxProducts: number;
}): Promise<EbayTradingCatalogImportPlan> {
  const maxProducts = normalizePositiveInteger(input.maxProducts);
  const entriesPerPage = Math.min(maxProducts, TRADING_API_MAX_ENTRIES_PER_PAGE);
  const itemIds: string[] = [];
  const seenItemIds = new Set<string>();
  let pageNumber = 1;
  let readCount = 0;
  let totalAvailable: number | null = null;
  let totalPages: number | null = null;

  while (itemIds.length < maxProducts) {
    if (totalPages !== null && pageNumber > totalPages) break;

    const xml = buildGetMyeBaySellingRequest({
      entriesPerPage,
      pageNumber,
    });
    const body = await fetchTradingXml({
      accessToken: input.accessToken,
      callName: "GetMyeBaySelling",
      connection: input.connection,
      requestXml: xml,
    });
    const activeList = asRecord(body.ActiveList);
    const items = getTradingItems(activeList);

    readCount += items.length;
    totalAvailable ??= getTotalEntries(activeList);
    totalPages ??= getTotalPages(activeList);

    for (const item of items) {
      const itemId = getString(item, "ItemID");
      if (!itemId || seenItemIds.has(itemId)) continue;

      seenItemIds.add(itemId);
      itemIds.push(itemId);

      if (itemIds.length >= maxProducts) break;
    }

    if (items.length === 0) break;
    if (totalAvailable !== null && readCount >= totalAvailable) break;
    if (items.length < entriesPerPage && totalPages === null) break;

    pageNumber += 1;
  }

  return {
    itemIds,
    readCount,
    totalAvailable,
  };
}

export async function getEbayTradingCandidatesByItemIds(input: {
  accessToken: string;
  connection: EbayConnection;
  itemIds: string[];
}) {
  const itemIds = Array.from(
    new Set(
      input.itemIds.flatMap((itemId) => {
        const normalizedItemId = normalizeText(itemId);
        return normalizedItemId ? [normalizedItemId] : [];
      }),
    ),
  );
  const candidates = await mapWithConcurrency(
    itemIds,
    GET_ITEM_LOOKUP_CONCURRENCY,
    async (itemId) => {
      const detailItem = await getTradingItemDetail(input, itemId);
      if (!detailItem) return null;

      const candidate = mapTradingItemToCandidate(detailItem, input.connection.marketplaceId);
      return candidate ? withFallbackSku(candidate) : null;
    },
  );

  return candidates.filter((candidate): candidate is ImportPreviewListingCandidate =>
    Boolean(candidate),
  );
}

export async function getEbayTradingSellerEventsDelta(input: {
  accessToken: string;
  connection: EbayConnection;
  maxEvents: number;
  modTimeFrom: Date;
  modTimeTo: Date;
}): Promise<EbayTradingSellerEventsDelta> {
  const body = await fetchTradingXml({
    accessToken: input.accessToken,
    callName: "GetSellerEvents",
    connection: input.connection,
    requestXml: buildGetSellerEventsRequest({
      modTimeFrom: input.modTimeFrom,
      modTimeTo: input.modTimeTo,
    }),
  });
  const allItems = getTradingItems(body);
  const items = allItems.slice(0, input.maxEvents);
  const candidates: ImportPreviewListingCandidate[] = [];
  const inactiveItemIds: string[] = [];

  for (const item of items) {
    const itemId = getString(item, "ItemID");
    if (!itemId) continue;

    if (isInactiveTradingItem(item)) {
      inactiveItemIds.push(itemId);
      continue;
    }

    const candidate = mapTradingItemToCandidate(item, input.connection.marketplaceId);
    if (candidate) candidates.push(withFallbackSku(candidate));
  }

  return {
    candidates,
    inactiveItemIds: [...new Set(inactiveItemIds)],
    readCount: allItems.length,
    timeFrom: input.modTimeFrom.toISOString(),
    timeTo: input.modTimeTo.toISOString(),
    truncated: allItems.length > input.maxEvents,
  };
}

class EbayTradingPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayTradingPreviewError";
  }
}

async function getEnrichedTradingCandidate(
  input: EbayTradingRequestContext,
  item: XmlRecord,
): Promise<ImportPreviewListingCandidate | null> {
  const listCandidate = mapTradingItemToCandidate(item, input.connection.marketplaceId);
  if (!listCandidate) return null;

  const detailItem = await getTradingItemDetail(input, listCandidate.itemId);
  if (!detailItem) return withFallbackSku(listCandidate);
  const detailVariations = getTradingVariations(detailItem);

  const detailStorefront = getEbayStorefrontMetadata(detailItem.Storefront);
  const detailPrimaryCategory = getTradingPrimaryCategoryMetadata(detailItem);

  return withFallbackSku({
    currency:
      getTradingCurrency(detailItem, detailVariations) ??
      listCandidate.currency ??
      getExpectedMarketplaceCurrency(input.connection.marketplaceId),
    descriptionHtml: getString(detailItem, "Description") ?? listCandidate.descriptionHtml,
    imageUrls: getTradingImageUrls(detailItem, listCandidate.imageUrls),
    itemId: listCandidate.itemId,
    itemSpecifics: parseEbayTradingItemSpecifics(detailItem.ItemSpecifics),
    priceAmount: getTradingPrice(detailItem, detailVariations) ?? listCandidate.priceAmount,
    ebayPrimaryCategoryId:
      detailPrimaryCategory.ebayPrimaryCategoryId ?? listCandidate.ebayPrimaryCategoryId ?? null,
    ebayPrimaryCategoryName:
      detailPrimaryCategory.ebayPrimaryCategoryName ??
      listCandidate.ebayPrimaryCategoryName ??
      null,
    ebayPrimaryCategoryPath:
      detailPrimaryCategory.ebayPrimaryCategoryPath ??
      listCandidate.ebayPrimaryCategoryPath ??
      null,
    quantity: getTradingQuantity(detailItem, detailVariations) ?? listCandidate.quantity,
    sku: getTradingSku(detailItem, detailVariations) ?? listCandidate.sku,
    storeCategoryId: detailStorefront.storeCategoryId ?? listCandidate.storeCategoryId ?? null,
    storeCategoryName:
      detailStorefront.storeCategoryName ?? listCandidate.storeCategoryName ?? null,
    title: getString(detailItem, "Title") ?? listCandidate.title,
    variantCount: Math.max(detailVariations.length, listCandidate.variantCount ?? 1),
  });
}

async function getTradingItemDetail(input: EbayTradingRequestContext, itemId: string) {
  const requestXml = buildGetItemRequest(itemId);

  return fetchTradingXml({
    accessToken: input.accessToken,
    callName: "GetItem",
    connection: input.connection,
    requestXml,
  })
    .then((body) => asRecord(body.Item))
    .catch(() => null);
}

export async function fetchTradingXml(input: {
  accessToken: string;
  callName: "GetItem" | "GetMyeBaySelling" | "GetSellerEvents" | "ReviseInventoryStatus";
  connection: EbayConnection;
  requestXml: string;
}) {
  const response = await fetch(getTradingBaseUrl(input.connection.environment), {
    body: input.requestXml,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_COMPATIBILITY_LEVEL,
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
      "X-EBAY-API-SITEID": getTradingSiteId(input.connection.marketplaceId),
    },
    method: "POST",
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new EbayTradingPreviewError(
      `eBay Trading API ${input.callName} ha risposto con HTTP ${response.status}.`,
    );
  }

  const parsed = xmlParser.parse(responseText) as unknown;
  const responseNode = asRecord(parsed)?.[`${input.callName}Response`];
  const body = asRecord(responseNode);
  if (!body) {
    throw new EbayTradingPreviewError(
      `eBay Trading API ${input.callName} ha restituito una risposta non leggibile.`,
    );
  }

  const ack = getString(body, "Ack");
  if (ack && !["Success", "Warning"].includes(ack)) {
    throw new EbayTradingPreviewError(getTradingApiErrorMessage(body));
  }

  return body;
}

function buildGetMyeBaySellingRequest(input: { entriesPerPage: number; pageNumber: number }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${input.entriesPerPage}</EntriesPerPage>
      <PageNumber>${input.pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
  <HideVariations>false</HideVariations>
</GetMyeBaySellingRequest>`;
}

function buildGetItemRequest(itemId: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
  <ItemID>${escapeXml(itemId)}</ItemID>
</GetItemRequest>`;
}

function buildGetSellerEventsRequest(input: { modTimeFrom: Date; modTimeTo: Date }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerEventsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ModTimeFrom>${input.modTimeFrom.toISOString()}</ModTimeFrom>
  <ModTimeTo>${input.modTimeTo.toISOString()}</ModTimeTo>
  <NewItemFilter>true</NewItemFilter>
  <HideVariations>false</HideVariations>
</GetSellerEventsRequest>`;
}

function getTradingItems(container: XmlRecord | null) {
  const itemArray = asRecord(container?.ItemArray);

  return asArray(itemArray?.Item).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function isInactiveTradingItem(item: XmlRecord) {
  const status =
    getString(asRecord(item.SellingStatus), "ListingStatus") ?? getString(item, "ListingStatus");
  if (!status) return false;

  return ["Completed", "Ended", "EndedWithSales", "EndedWithoutSales", "Inactive"].includes(status);
}

function mapTradingItemToCandidate(
  item: XmlRecord,
  marketplaceId: string,
): ImportPreviewListingCandidate | null {
  const itemId = getString(item, "ItemID");
  if (!itemId) return null;

  const variations = getTradingVariations(item);
  const storefront = getEbayStorefrontMetadata(item.Storefront);
  const primaryCategory = getTradingPrimaryCategoryMetadata(item);

  return {
    currency: getTradingCurrency(item, variations) ?? getExpectedMarketplaceCurrency(marketplaceId),
    descriptionHtml: getString(item, "Description"),
    ebayPrimaryCategoryId: primaryCategory.ebayPrimaryCategoryId,
    ebayPrimaryCategoryName: primaryCategory.ebayPrimaryCategoryName,
    ebayPrimaryCategoryPath: primaryCategory.ebayPrimaryCategoryPath,
    imageUrls: getTradingImageUrls(item),
    itemId,
    itemSpecifics: parseEbayTradingItemSpecifics(item.ItemSpecifics),
    priceAmount: getTradingPrice(item, variations),
    quantity: getTradingQuantity(item, variations),
    sku: getTradingSku(item, variations),
    storeCategoryId: storefront.storeCategoryId,
    storeCategoryName: storefront.storeCategoryName,
    title: getString(item, "Title"),
    variantCount: Math.max(variations.length, 1),
  };
}

function getTradingPrimaryCategoryMetadata(item: XmlRecord) {
  const primaryCategory = asRecord(item.PrimaryCategory);
  const categoryId = getString(primaryCategory, "CategoryID");
  const categoryName = getString(primaryCategory, "CategoryName");

  return {
    ebayPrimaryCategoryId: categoryId,
    ebayPrimaryCategoryName: categoryName,
    ebayPrimaryCategoryPath: null,
  };
}

function getTradingVariations(item: XmlRecord) {
  const variations = asRecord(item.Variations);
  const variation = asRecord(variations?.Variation);

  if (variation) return [variation];

  return asArray(variations?.Variation).flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}

function getTradingSku(item: XmlRecord, variations: XmlRecord[]) {
  return (
    getString(item, "SKU") ??
    variations.map((variation) => getString(variation, "SKU")).find(Boolean) ??
    null
  );
}

function withFallbackSku(candidate: ImportPreviewListingCandidate): ImportPreviewListingCandidate {
  if (normalizeText(candidate.sku)) {
    return {
      ...candidate,
      skuGenerated: false,
    };
  }

  return {
    ...candidate,
    sku: `EBAY-${candidate.itemId}`,
    skuGenerated: true,
  };
}

function getTradingImageUrls(item: XmlRecord, fallbackUrls: string[] = []) {
  const pictureDetails = asRecord(item.PictureDetails);
  const directUrls = asArray(pictureDetails?.PictureURL).flatMap((url) => {
    const text = normalizeText(toText(url));
    return text ? [text] : [];
  });

  if (directUrls.length > 0) return directUrls;

  const variations = asRecord(item.Variations);
  const pictures = asRecord(variations?.Pictures);
  const pictureSets = asArray(pictures?.VariationSpecificPictureSet);

  const variationUrls = pictureSets.flatMap((pictureSet) => {
    const record = asRecord(pictureSet);
    return asArray(record?.PictureURL).flatMap((url) => {
      const text = normalizeText(toText(url));
      return text ? [text] : [];
    });
  });

  return variationUrls.length > 0 ? variationUrls : fallbackUrls;
}

function getTradingPrice(item: XmlRecord, variations: XmlRecord[]) {
  return (
    getMoneyValue(asRecord(item.SellingStatus)?.CurrentPrice) ??
    getMoneyValue(item.StartPrice) ??
    getMoneyValue(item.BuyItNowPrice) ??
    variations
      .map((variation) => getMoneyValue(variation.StartPrice))
      .find((price): price is number => typeof price === "number") ??
    null
  );
}

function getTradingCurrency(item: XmlRecord, variations: XmlRecord[]) {
  return (
    getMoneyCurrency(asRecord(item.SellingStatus)?.CurrentPrice) ??
    getMoneyCurrency(item.StartPrice) ??
    getMoneyCurrency(item.BuyItNowPrice) ??
    variations
      .map((variation) => getMoneyCurrency(variation.StartPrice))
      .find((currency): currency is string => Boolean(currency)) ??
    null
  );
}

function getTradingQuantity(item: XmlRecord, variations: XmlRecord[]) {
  const variationQuantities = variations.flatMap((variation) => {
    const quantity = getAvailableQuantity(variation);
    return typeof quantity === "number" ? [quantity] : [];
  });

  if (variationQuantities.length > 0) {
    return variationQuantities.reduce((total, quantity) => total + quantity, 0);
  }

  return getAvailableQuantity(item);
}

function getAvailableQuantity(record: XmlRecord) {
  const directQuantity = getInteger(record, "QuantityAvailable");
  if (typeof directQuantity === "number") return directQuantity;

  const quantity = getInteger(record, "Quantity");
  if (typeof quantity !== "number") return null;

  const quantitySold = getInteger(asRecord(record.SellingStatus), "QuantitySold");
  return Math.max(quantity - (quantitySold ?? 0), 0);
}

function getTotalEntries(activeList: XmlRecord | null) {
  const paginationResult = asRecord(activeList?.PaginationResult);
  const total = getInteger(paginationResult, "TotalNumberOfEntries");

  return typeof total === "number" ? total : null;
}

function getTotalPages(activeList: XmlRecord | null) {
  const paginationResult = asRecord(activeList?.PaginationResult);
  const total = getInteger(paginationResult, "TotalNumberOfPages");

  return typeof total === "number" ? total : null;
}

function getTradingApiErrorMessage(body: XmlRecord) {
  const errors: string[] = [];

  for (const errorNode of asArray(body.Errors)) {
    const error = asRecord(errorNode);
    const shortMessage = getString(error, "ShortMessage");
    const longMessage = getString(error, "LongMessage");
    const message = normalizeText(longMessage ?? shortMessage);

    if (message) errors.push(message);
  }

  return errors.length > 0
    ? `eBay Trading API ha risposto: ${errors.join("; ")}.`
    : "eBay Trading API non ha completato la lettura dei listing.";
}

function getTradingBaseUrl(environment: string) {
  return environment === "production" ? EBAY_TRADING_URLS.production : EBAY_TRADING_URLS.sandbox;
}

function getTradingSiteId(marketplaceId: string) {
  return EBAY_TRADING_SITE_IDS[marketplaceId] ?? "0";
}

function getMoneyValue(value: unknown) {
  const text = toText(value);
  if (!text) return null;

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMoneyCurrency(value: unknown) {
  const record = asRecord(value);
  const currency = record ? normalizeText(toText(record["@_currencyID"])) : null;

  return currency?.toUpperCase() ?? null;
}

function getInteger(record: XmlRecord | null, key: string) {
  const text = record ? toText(record[key]) : null;
  if (!text) return null;

  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function getString(record: XmlRecord | null, key: string) {
  return record ? normalizeText(toText(record[key])) : null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const record = asRecord(value);
  const text = record?.["#text"];
  if (typeof text === "string") return text;
  if (typeof text === "number") return String(text);

  return null;
}

function asRecord(value: unknown): XmlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlRecord) : null;
}

function asArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value === "undefined") return [];

  return [value];
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizePositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
