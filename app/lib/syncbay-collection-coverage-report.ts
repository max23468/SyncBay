export interface CollectionCoverageCollection {
  handle: string;
  title: string;
}

export interface CollectionCoverageProduct {
  collections: CollectionCoverageCollection[];
  handle: string;
  id: string;
  productType: string | null;
  title: string;
  totalInventory: number | null;
}

export interface CollectionCoverageReportRow {
  collections: string[];
  handle: string;
  id: string;
  productType: string | null;
  specificCollections: string[];
  title: string;
  totalInventory: number;
}

export interface CollectionCoverageReport {
  availableOnlyGeneric: CollectionCoverageReportRow[];
  summary: {
    available: number;
    availableOnlyGeneric: number;
    total: number;
    unavailableInSpecific: number;
  };
  unavailableInSpecific: CollectionCoverageReportRow[];
}

export function buildCollectionCoverageReport(input: {
  genericCollectionHandles: string[];
  products: CollectionCoverageProduct[];
}): CollectionCoverageReport {
  const genericHandles = new Set(input.genericCollectionHandles);
  const rows = input.products.map(toReportRow);
  const availableRows = rows.filter((row) => row.totalInventory > 0);
  const availableOnlyGeneric = availableRows.filter(
    (row) => row.specificCollections.length === 0,
  );
  const unavailableInSpecific = rows.filter(
    (row) => row.totalInventory <= 0 && row.specificCollections.length > 0,
  );

  return {
    availableOnlyGeneric,
    summary: {
      available: availableRows.length,
      availableOnlyGeneric: availableOnlyGeneric.length,
      total: rows.length,
      unavailableInSpecific: unavailableInSpecific.length,
    },
    unavailableInSpecific,
  };

  function toReportRow(
    product: CollectionCoverageProduct,
  ): CollectionCoverageReportRow {
    const collections = product.collections.map((collection) => collection.title);
    const specificCollections = product.collections
      .filter((collection) => !genericHandles.has(collection.handle))
      .map((collection) => collection.title);

    return {
      collections,
      handle: product.handle,
      id: product.id,
      productType: product.productType,
      specificCollections,
      title: product.title,
      totalInventory: Number(product.totalInventory ?? 0),
    };
  }
}
