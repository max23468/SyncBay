export function getCatalogReconcileBlockingJobTypes<T extends string>(types: {
  archiveInactiveListing: T;
  importCatalog: T;
  syncIncremental: T;
}) {
  return [
    types.importCatalog,
    types.syncIncremental,
    types.archiveInactiveListing,
  ];
}
