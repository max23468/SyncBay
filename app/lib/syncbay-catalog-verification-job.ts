import prismaClient from "@prisma/client";
import type { Prisma as PrismaTypes } from "@prisma/client";

const { SyncJobStatus, SyncJobType } = prismaClient;

export function getCompletedCatalogVerificationJobWhere(
  shopId: string,
): PrismaTypes.SyncJobWhereInput {
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
          {
            OR: [
              { result: { path: ["noWork"], equals: true } },
              { result: { path: ["watermarkAdvanced"], equals: true } },
            ],
          },
        ],
      },
    ],
    shopId,
    status: SyncJobStatus.SUCCEEDED,
    type: SyncJobType.SYNC_INCREMENTAL,
  };
}
