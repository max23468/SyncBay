export interface StockBaselineSnapshot {
  capturedAt: Date;
  currency: string | null;
  quantity: number | null;
}

export function selectLatestStockBaselineSnapshot<TSnapshot extends StockBaselineSnapshot>(
  snapshots: TSnapshot[],
) {
  return (
    [...snapshots]
      .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime())
      .find(
        (snapshot) =>
          snapshot.quantity !== null &&
          snapshot.quantity !== undefined &&
          Boolean(snapshot.currency),
      ) ?? null
  );
}
