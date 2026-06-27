export interface ExistingCatalogPreviewMetadata {
  readCount: number;
  totalAvailable: number | null;
  totalPlanned: number;
  truncatedAtMaxProducts: boolean;
}

export function buildExistingCatalogPreviewMetadata(input: {
  maxProducts: number;
  readCount: number;
  totalAvailable: number | null;
  totalPlanned: number;
}): ExistingCatalogPreviewMetadata {
  return {
    readCount: input.readCount,
    totalAvailable: input.totalAvailable,
    totalPlanned: input.totalPlanned,
    truncatedAtMaxProducts:
      input.totalAvailable !== null
        ? input.totalAvailable > input.totalPlanned
        : input.totalPlanned >= input.maxProducts,
  };
}
