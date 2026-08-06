import {
  asEbayTradingRecord as asRecord,
  EBAY_TRADING_API_COMPATIBILITY_LEVEL,
  getEbayTradingString as getString,
} from "./syncbay-ebay-trading.ts";

export interface TradingItemCacheEntry {
  descriptionHtml: string | null;
  itemId: string;
  title: string | null;
}

export function buildGetSellerListRequest(input: {
  entriesPerPage: number;
  pageNumber: number;
  windowEnd: Date;
  windowStart: Date;
}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Version>${EBAY_TRADING_API_COMPATIBILITY_LEVEL}</Version>
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>it_IT</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <EndTimeFrom>${input.windowStart.toISOString()}</EndTimeFrom>
  <EndTimeTo>${input.windowEnd.toISOString()}</EndTimeTo>
  <GranularityLevel>Fine</GranularityLevel>
  <IncludeVariations>true</IncludeVariations>
  <Pagination>
    <EntriesPerPage>${input.entriesPerPage}</EntriesPerPage>
    <PageNumber>${input.pageNumber}</PageNumber>
  </Pagination>
</GetSellerListRequest>`;
}

export function buildTradingItemCache(items: unknown[]) {
  const cache = new Map<string, TradingItemCacheEntry>();

  for (const item of items) {
    const record = asRecord(item);
    const itemId = getString(record, "ItemID")?.trim();
    if (!itemId || cache.has(itemId)) continue;

    cache.set(itemId, {
      descriptionHtml: getString(record, "Description"),
      itemId,
      title: getString(record, "Title"),
    });
  }

  return cache;
}
