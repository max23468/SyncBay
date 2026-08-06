import { XMLParser } from "fast-xml-parser";

export const EBAY_TRADING_API_COMPATIBILITY_LEVEL = "1455";

export type EbayTradingCallName =
  | "GetItem"
  | "GetMyeBaySelling"
  | "GetSellerEvents"
  | "GetSellerList"
  | "ReviseInventoryStatus";

type XmlRecord = Record<string, unknown>;

const EBAY_TRADING_URLS = {
  production: "https://api.ebay.com/ws/api.dll",
  sandbox: "https://api.sandbox.ebay.com/ws/api.dll",
};
const EBAY_TRADING_SITE_IDS: Record<string, string> = {
  EBAY_IT: "101",
};
const TRADING_API_ERROR_LANGUAGE = "it_IT";
const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true,
});

export function getEbayTradingBaseUrl(environment: string) {
  return environment === "production" ? EBAY_TRADING_URLS.production : EBAY_TRADING_URLS.sandbox;
}

export function buildEbayTradingHeaders(input: {
  accessToken: string;
  callName: EbayTradingCallName;
  marketplaceId: string;
}) {
  const siteId = EBAY_TRADING_SITE_IDS[input.marketplaceId];
  if (!siteId) {
    throw new Error(`Marketplace Trading API non supportato: ${input.marketplaceId}.`);
  }

  return {
    "Content-Type": "text/xml; charset=utf-8",
    "X-EBAY-API-CALL-NAME": input.callName,
    "X-EBAY-API-COMPATIBILITY-LEVEL": EBAY_TRADING_API_COMPATIBILITY_LEVEL,
    "X-EBAY-API-IAF-TOKEN": input.accessToken,
    "X-EBAY-API-SITEID": siteId,
  };
}

export function parseEbayTradingResponse(callName: EbayTradingCallName, responseText: string) {
  const parsed = xmlParser.parse(responseText) as unknown;
  const body = asEbayTradingRecord(asEbayTradingRecord(parsed)?.[`${callName}Response`]);
  if (!body) {
    throw new Error(`eBay Trading API ${callName} ha restituito una risposta non leggibile.`);
  }

  const ack = getEbayTradingString(body, "Ack");
  if (ack && !["Success", "Warning"].includes(ack)) {
    const errors = asEbayTradingArray(body.Errors).flatMap((errorNode) => {
      const error = asEbayTradingRecord(errorNode);
      const message =
        getEbayTradingString(error, "LongMessage") ?? getEbayTradingString(error, "ShortMessage");
      return message?.trim() ? [message.trim()] : [];
    });

    throw new Error(
      errors.length > 0
        ? `eBay Trading API ha risposto: ${errors.join("; ")}.`
        : `eBay Trading API ${callName} non riuscita.`,
    );
  }

  return body;
}

export function buildGetMyeBaySellingRequest(input: {
  entriesPerPage: number;
  pageNumber: number;
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${EBAY_TRADING_API_COMPATIBILITY_LEVEL}</Version>
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

export function buildGetItemRequest(input: { includeItemSpecifics?: boolean; itemId: string }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${EBAY_TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>${
    input.includeItemSpecifics ? "\n  <IncludeItemSpecifics>true</IncludeItemSpecifics>" : ""
  }
  <ItemID>${escapeEbayTradingXml(input.itemId)}</ItemID>
</GetItemRequest>`;
}

export function buildGetSellerEventsRequest(input: { modTimeFrom: Date; modTimeTo: Date }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerEventsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${EBAY_TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <ModTimeFrom>${input.modTimeFrom.toISOString()}</ModTimeFrom>
  <ModTimeTo>${input.modTimeTo.toISOString()}</ModTimeTo>
  <NewItemFilter>true</NewItemFilter>
  <HideVariations>false</HideVariations>
</GetSellerEventsRequest>`;
}

export function buildReviseInventoryStatusRequest(input: {
  itemId: string;
  quantity: number;
  sku?: string | null;
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${EBAY_TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <ErrorLanguage>${TRADING_API_ERROR_LANGUAGE}</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <InventoryStatus>
    <ItemID>${escapeEbayTradingXml(input.itemId)}</ItemID>
    ${input.sku ? `<SKU>${escapeEbayTradingXml(input.sku)}</SKU>` : ""}
    <Quantity>${Math.max(0, Math.floor(input.quantity))}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
}

export function escapeEbayTradingXml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function asEbayTradingRecord(value: unknown): XmlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlRecord) : null;
}

export function asEbayTradingArray(value: unknown) {
  if (Array.isArray(value)) return value;
  return value === null || typeof value === "undefined" ? [] : [value];
}

export function getEbayTradingText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  const text = asEbayTradingRecord(value)?.["#text"];
  return typeof text === "string" || typeof text === "number" ? String(text) : null;
}

export function getEbayTradingString(record: XmlRecord | null, key: string) {
  return record ? getEbayTradingText(record[key]) : null;
}
