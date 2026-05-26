import type { EbayConnection } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";

import type { ImportPreviewListingCandidate } from "./import-preview.server";

interface EbayTradingPreviewInput {
  accessToken: string;
  connection: EbayConnection;
  limit: number;
}

type EbayTradingRequestContext = Pick<
  EbayTradingPreviewInput,
  "accessToken" | "connection"
>;

export interface EbayTradingPreviewPage {
  candidates: ImportPreviewListingCandidate[];
  readCount: number;
  totalAvailable: number | null;
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
  const xml = buildGetMyeBaySellingRequest(input.limit);
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
        const listCandidate = mapTradingItemToCandidate(item);
        return listCandidate ? withFallbackSku(listCandidate) : null;
      }

      return getEnrichedTradingCandidate(input, item);
    },
  );

  return {
    candidates: candidates.filter(
      (candidate): candidate is ImportPreviewListingCandidate =>
        Boolean(candidate),
    ),
    readCount: items.length,
    totalAvailable: getTotalEntries(activeList),
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

      const candidate = mapTradingItemToCandidate(detailItem);
      return candidate ? withFallbackSku(candidate) : null;
    },
  );

  return candidates.filter(
    (candidate): candidate is ImportPreviewListingCandidate =>
      Boolean(candidate),
  );
}

class EbayTradingPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EbayTradingPreviewError";
  }
}

async function getEnrichedTradingCandidate(
  input: EbayTradingPreviewInput,
  item: XmlRecord,
): Promise<ImportPreviewListingCandidate | null> {
  const listCandidate = mapTradingItemToCandidate(item);
  if (!listCandidate) return null;

  const detailItem = await getTradingItemDetail(input, listCandidate.itemId);
  if (!detailItem) return withFallbackSku(listCandidate);
  const detailVariations = getTradingVariations(detailItem);

  return withFallbackSku({
    descriptionHtml:
      getString(detailItem, "Description") ?? listCandidate.descriptionHtml,
    imageUrls: getTradingImageUrls(detailItem, listCandidate.imageUrls),
    itemId: listCandidate.itemId,
    priceAmount:
      getTradingPrice(detailItem, detailVariations) ?? listCandidate.priceAmount,
    quantity:
      getTradingQuantity(detailItem, detailVariations) ?? listCandidate.quantity,
    sku: getTradingSku(detailItem, detailVariations) ?? listCandidate.sku,
    title: getString(detailItem, "Title") ?? listCandidate.title,
    variantCount: Math.max(
      detailVariations.length,
      listCandidate.variantCount ?? 1,
    ),
  });
}

async function getTradingItemDetail(
  input: EbayTradingRequestContext,
  itemId: string,
) {
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

async function fetchTradingXml(input: {
  accessToken: string;
  callName: "GetItem" | "GetMyeBaySelling";
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

function buildGetMyeBaySellingRequest(limit: number) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${limit}</EntriesPerPage>
      <PageNumber>1</PageNumber>
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

function getTradingItems(activeList: XmlRecord | null) {
  const itemArray = asRecord(activeList?.ItemArray);

  return asArray(itemArray?.Item).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function mapTradingItemToCandidate(
  item: XmlRecord,
): ImportPreviewListingCandidate | null {
  const itemId = getString(item, "ItemID");
  if (!itemId) return null;

  const variations = getTradingVariations(item);

  return {
    descriptionHtml: getString(item, "Description"),
    imageUrls: getTradingImageUrls(item),
    itemId,
    priceAmount: getTradingPrice(item, variations),
    quantity: getTradingQuantity(item, variations),
    sku: getTradingSku(item, variations),
    title: getString(item, "Title"),
    variantCount: Math.max(variations.length, 1),
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

function withFallbackSku(
  candidate: ImportPreviewListingCandidate,
): ImportPreviewListingCandidate {
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
  return environment === "production"
    ? EBAY_TRADING_URLS.production
    : EBAY_TRADING_URLS.sandbox;
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : null;
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

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function mapWithConcurrency<Input, Output>(
  items: Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
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

    return mapper(items[currentIndex], currentIndex).then((result) => {
      results[currentIndex] = result;
      return runNext();
    });
  };

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  return results;
}
