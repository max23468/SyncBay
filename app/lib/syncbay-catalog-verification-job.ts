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

export function getCompletedIncrementalWorkJobWhere(
  shopId: string,
): PrismaTypes.SyncJobWhereInput {
  // Esclude i job marker di solo avanzamento watermark (payload/result
  // watermarkAdvanced === true): non sono lavoro reale e non devono contare come
  // ultimo run. NOT su una lista nega l'unione delle condizioni, quindi tiene i
  // job dove watermarkAdvanced è false o assente. È l'inverso del filtro
  // positivo già usato in getCompletedCatalogVerificationJobWhere.
  return {
    NOT: [
      { payload: { path: ["watermarkAdvanced"], equals: true } },
      { result: { path: ["watermarkAdvanced"], equals: true } },
    ],
    shopId,
    status: SyncJobStatus.SUCCEEDED,
    type: SyncJobType.SYNC_INCREMENTAL,
  };
}
