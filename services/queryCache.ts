export type CacheFetcher<T> = () => Promise<T>;

const queryCache = new Map<string, Promise<any>>();

type CacheOptions = {
  force?: boolean;
};

export async function fetchWithCache<T>(key: string, fetcher: CacheFetcher<T>, options?: CacheOptions): Promise<T> {
  if (options?.force) {
    queryCache.delete(key);
  }
  if (!queryCache.has(key)) {
    const promise = (async () => fetcher())();
    queryCache.set(key, promise);
  }
  try {
    return await queryCache.get(key);
  } catch (err) {
    queryCache.delete(key);
    throw err;
  }
}

export function invalidateCache(key: string) {
  queryCache.delete(key);
}

export function clearAllCache() {
  queryCache.clear();
}
