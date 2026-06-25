import { Prisma, ProductSnapshotSource } from "@prisma/client";

const SYNCBAY_MONITORED_CONFLICT_FIELDS = [
  "title",
  "description",
  "status",
  "price",
  "quantity",
  "images",
] as const;

export function getLatestSyncBayDescriptionBaselineWhere(
  mappingId: string,
): Prisma.ProductSnapshotWhereInput {
  return {
    descriptionHash: { not: null },
    mappingId,
    source: ProductSnapshotSource.SYNCBAY,
  };
}

export function shouldUseSyncBayDescriptionBaselinePayload(
  payload: Prisma.JsonValue | null | undefined,
) {
  const objectPayload = getJsonObject(payload);

  if (!objectPayload) return true;

  const isStockTestSnapshot =
    objectPayload.updatedEbayFromShopifyOrder === true ||
    objectPayload.restoredEbayAfterTest === true;

  if (!isStockTestSnapshot) return true;

  return objectPayload.conflictResolution != null;
}

export const SYNCBAY_DESCRIPTION_BASELINE_PAYLOAD_SQL = Prisma.sql`
  (
    "payload" IS NULL
    OR jsonb_typeof("payload") <> 'object'
    OR NOT (
      "payload" @> '{"updatedEbayFromShopifyOrder": true}'::jsonb
      OR "payload" @> '{"restoredEbayAfterTest": true}'::jsonb
    )
    OR (
      "payload" ? 'conflictResolution'
      AND "payload"->'conflictResolution' <> 'null'::jsonb
    )
  )
`;

export function getAlignedOpenConflictFields(input: {
  detectedConflictFields: string[];
  openConflictFields: string[];
}) {
  const monitoredFields = new Set<string>(SYNCBAY_MONITORED_CONFLICT_FIELDS);
  const detectedFields = new Set(input.detectedConflictFields);

  return [...new Set(input.openConflictFields)].filter(
    (field) => monitoredFields.has(field) && !detectedFields.has(field),
  );
}

export function shouldSkipQuantityConflictForArchivedProduct(input: {
  shopifyProductStatus: string | null;
  syncBayProductStatus: string | null;
  syncBayQuantity: number | null;
}) {
  return (
    input.syncBayProductStatus === "ARCHIVED" &&
    input.shopifyProductStatus === "ARCHIVED" &&
    input.syncBayQuantity === 0
  );
}

export function shouldDetectShopifyConflictsForMappingStatus(
  mappingStatus: string | null,
) {
  return mappingStatus === "ACTIVE";
}

export function shouldBlockIncrementalSyncForOpenConflictMappingStatus(
  mappingStatus: string | null,
) {
  return (
    mappingStatus === "ACTIVE" ||
    mappingStatus === "PAUSED" ||
    mappingStatus === "ERROR"
  );
}

export function shouldResolveOpenConflictsForInactiveMappingStatus(
  mappingStatus: string | null,
) {
  return mappingStatus === "OUT_OF_STOCK" || mappingStatus === "ARCHIVED";
}

export function shouldResolveLiveAlignedDescriptionConflictForMappingStatus(
  mappingStatus: string | null,
) {
  return shouldDetectShopifyConflictsForMappingStatus(mappingStatus);
}

export function isLiveDescriptionConflictAligned(input: {
  currentShopifyDescriptionHash: string | null;
  field: string;
  latestSyncBayDescriptionHash: string | null;
}) {
  return (
    input.field === "description" &&
    typeof input.latestSyncBayDescriptionHash === "string" &&
    input.latestSyncBayDescriptionHash.trim().length > 0 &&
    typeof input.currentShopifyDescriptionHash === "string" &&
    input.latestSyncBayDescriptionHash.trim() ===
      input.currentShopifyDescriptionHash.trim()
  );
}

export function shouldSkipImagesConflictWhenEbayHasNoImages(input: {
  syncBayImageCount: number | null;
  shopifyImageCount: number;
}) {
  return input.syncBayImageCount === 0 && input.shopifyImageCount > 0;
}

export function shouldSkipDescriptionConflictWhenEbayHasNoDescription(input: {
  syncBayDescriptionHash: string | null;
  shopifyDescriptionHash: string | null;
}) {
  const hasSyncBayBaseline =
    typeof input.syncBayDescriptionHash === "string" &&
    input.syncBayDescriptionHash.trim().length > 0;

  return !hasSyncBayBaseline && input.shopifyDescriptionHash !== null;
}

function getJsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return value as Prisma.JsonObject;
}
