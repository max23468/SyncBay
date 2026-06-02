const SHOPIFY_IMPORT_JOB_IDEMPOTENCY_PREFIX = "draft-import:";
const SHOPIFY_IMPORT_JOB_SOURCE = "shopify_import";

export type EbayItemJobPayload = Record<string, unknown> & {
  ebayItemIds?: unknown;
};

export function isSchedulableSyncJob(input: {
  idempotencyKey?: string | null;
  payload: unknown;
}) {
  if (input.idempotencyKey?.startsWith(SHOPIFY_IMPORT_JOB_IDEMPOTENCY_PREFIX)) {
    return false;
  }

  return getStringField(input.payload, "source") !== SHOPIFY_IMPORT_JOB_SOURCE;
}

export function buildEbayItemJobSplitPayloads(input: {
  ebayItemIds: string[];
  maxItems: number;
  parentJobId: string;
  payload: EbayItemJobPayload;
}) {
  const maxItems = normalizeMaxItems(input.maxItems);
  const chunks = chunkArray(input.ebayItemIds, maxItems);

  return chunks.map((ebayItemIds, index) => ({
    ...input.payload,
    ebayItemIds,
    parentJobId: input.parentJobId,
    requestedCount: ebayItemIds.length,
    splitCount: chunks.length,
    splitIndex: index + 1,
  }));
}

function normalizeMaxItems(maxItems: number) {
  if (!Number.isInteger(maxItems) || maxItems < 1) return 1;

  return maxItems;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const field = (value as Record<string, unknown>)[key];

  return typeof field === "string" ? field : null;
}
