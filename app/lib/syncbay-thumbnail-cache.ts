export type ThumbnailCacheEntry = {
  expiresAt: number;
  value: string | null;
};

export function readFreshThumbnailCacheEntries(input: {
  cache: Map<string, ThumbnailCacheEntry>;
  keys: string[];
  nowMs: number;
}) {
  const hits = new Map<string, string>();
  const misses: string[] = [];

  for (const key of [...new Set(input.keys)]) {
    const cached = input.cache.get(key);

    if (!cached || cached.expiresAt <= input.nowMs) {
      input.cache.delete(key);
      misses.push(key);
      continue;
    }

    if (cached.value) hits.set(key, cached.value);
  }

  return { hits, misses };
}

export function writeThumbnailCacheEntries(input: {
  cache: Map<string, ThumbnailCacheEntry>;
  keys: string[];
  nowMs: number;
  ttlMs: number;
  values: Map<string, string>;
}) {
  const expiresAt = input.nowMs + Math.max(0, input.ttlMs);

  for (const key of [...new Set(input.keys)]) {
    input.cache.set(key, {
      expiresAt,
      value: input.values.get(key) ?? null,
    });
  }
}
