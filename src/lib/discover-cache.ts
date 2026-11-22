type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function getOrLoadDiscoverData<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const request = loader().then((value) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).finally(() => {
    if (inflight.get(key) === request) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}
