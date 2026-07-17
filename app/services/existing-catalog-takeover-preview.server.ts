import type { EbayConnection } from "@prisma/client";

import type { DescriptionRuleMode } from "../lib/syncbay-description-rules";
import { getUsableEbayAccessToken } from "./ebay-token.server";
import { getEbayTradingCatalogImportPreview } from "./ebay-trading-preview.server";
import { getEmptyImportPreview } from "./import-preview.server";

export interface ExistingCatalogPreviewInput {
  connection: EbayConnection;
  descriptionRuleMode: DescriptionRuleMode;
  maxProducts: number;
}

interface ExistingCatalogPreviewPorts {
  getAccessToken: (
    connection: EbayConnection,
  ) => Promise<{ accessToken: string }>;
  getPreview: typeof getEbayTradingCatalogImportPreview;
}

const defaultPorts: ExistingCatalogPreviewPorts = {
  getAccessToken: getUsableEbayAccessToken,
  getPreview: getEbayTradingCatalogImportPreview,
};

export async function getExistingCatalogTakeoverPreview(
  input: ExistingCatalogPreviewInput,
  ports: ExistingCatalogPreviewPorts = defaultPorts,
) {
  try {
    const { accessToken } = await ports.getAccessToken(input.connection);
    const preview = await ports.getPreview({
      accessToken,
      connection: input.connection,
      descriptionRuleMode: input.descriptionRuleMode,
      maxProducts: input.maxProducts,
    });
    const totalAvailableLabel =
      preview.totalAvailable === null
        ? `almeno ${preview.totalPlanned}`
        : String(preview.totalAvailable);

    return {
      coverageNote: preview.truncatedAtMaxProducts
        ? `Simulazione catalogo esistente da Trading API eBay: lette ${preview.totalPlanned} inserzioni da GetMyeBaySelling entro limite 1.0 ${input.maxProducts}. Il catalogo eBay dichiara ${totalAvailableLabel} inserzioni; i dettagli GetItem sono limitati per proteggere rate limit e timeout.`
        : "Simulazione catalogo esistente da Trading API eBay: tutte le inserzioni attive lette da GetMyeBaySelling in sola lettura entro il limite 1.0; i dettagli GetItem sono limitati per proteggere rate limit e timeout.",
      errorMessage: null,
      previewResult: preview.previewResult,
      readCount: preview.readCount,
      readCounts: {
        inventoryApi: 0,
        tradingApi: preview.readCount,
      },
      source: "trading_api" as const,
      totalAvailable: preview.totalAvailable,
    };
  } catch (error) {
    return {
      coverageNote:
        "Simulazione catalogo esistente da Trading API eBay: lettura completa in sola lettura non completata.",
      errorMessage:
        error instanceof Error
          ? error.message
          : "eBay Trading API non ha completato il dry-run catalogo esistente.",
      previewResult: getEmptyImportPreview("live"),
      readCount: 0,
      readCounts: {
        inventoryApi: 0,
        tradingApi: 0,
      },
      source: "trading_api" as const,
      totalAvailable: null,
    };
  }
}
