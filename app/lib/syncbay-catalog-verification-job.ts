import { Prisma, SyncJobStatus, SyncJobType } from "@prisma/client";

export function getCompletedCatalogVerificationJobWhere(
  shopId: string,
): Prisma.SyncJobWhereInput {
  return {
    OR: [
      {
        AND: [
          { payload: { path: ["source"], equals: "seller_events_delta" } },
          { payload: { path: ["watermarkAdvanced"], equals: true } },
        ],
      },
      {
        AND: [
          { payload: { path: ["source"], equals: "catalog_reconcile" } },
          { result: { path: ["noWork"], equals: true } },
        ],
      },
    ],
    shopId,
    status: SyncJobStatus.SUCCEEDED,
    type: SyncJobType.SYNC_INCREMENTAL,
  };
}
