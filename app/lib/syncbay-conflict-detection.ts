import { Prisma, ProductSnapshotSource } from "@prisma/client";

export const SYNCBAY_MONITORED_CONFLICT_FIELDS = [
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
    NOT: [
      {
        AND: [
          {
            payload: {
              path: ["updatedEbayFromShopifyOrder"],
              equals: true,
            },
          },
          {
            payload: {
              path: ["conflictResolution"],
              equals: Prisma.DbNull,
            },
          },
        ],
      },
      {
        AND: [
          {
            payload: {
              path: ["restoredEbayAfterTest"],
              equals: true,
            },
          },
          {
            payload: {
              path: ["conflictResolution"],
              equals: Prisma.DbNull,
            },
          },
        ],
      },
    ],
    source: ProductSnapshotSource.SYNCBAY,
  };
}

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

export function shouldSkipImagesConflictWhenEbayHasNoImages(input: {
  syncBayImageCount: number | null;
  shopifyImageCount: number;
}) {
  return input.syncBayImageCount === 0 && input.shopifyImageCount > 0;
}
