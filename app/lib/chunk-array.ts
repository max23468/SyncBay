export function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
