import type { Env } from "./types";

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function ttlSeconds(env: Env): number {
  const parsed = Number(env.CACHE_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TTL_SECONDS;
}

export function cacheEnabled(env: Env): boolean {
  return env.CACHE_ENABLED !== "false";
}

function defaultCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  const api = caches as unknown as { default?: Cache };
  return typeof api.default === "function" || api.default instanceof Cache ? (api.default ?? null) : null;
}

export function buildCacheKey(kind: string, query: string, provider: string): string {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  return `https://audiobook-cache.internal/${kind}?q=${encodeURIComponent(normalizedQuery)}&p=${encodeURIComponent(provider)}`;
}

export async function getCachedValue<T>(key: string, env: Env): Promise<T | null> {
  if (!cacheEnabled(env)) return null;
  const cache = defaultCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(new Request(key));
    if (!hit) return null;
    return (await hit.json()) as T;
  } catch {
    return null;
  }
}

export async function setCachedValue(key: string, value: unknown, env: Env): Promise<void> {
  if (!cacheEnabled(env)) return;
  const cache = defaultCache();
  if (!cache) return;
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttlSeconds(env)}`,
        "X-Cache-Ttl": String(ttlSeconds(env)),
      },
    });
    await cache.put(new Request(key), response);
  } catch {
    // Cache is best-effort; never fail the search because caching failed.
  }
}
