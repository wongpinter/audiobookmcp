import type { Env, WebResult } from "../../types";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "../fetch";
import type { SearchAdapter } from "../index";
import { SearchProviderHttpError } from "../errors";

export const braveSearch: SearchAdapter = async (query: string, env: Env, limit: number, signal?: AbortSignal) => {
  if (!env.BRAVE_API_KEY) throw new Error("BRAVE_API_KEY is not configured");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  const response = await fetchWithRateLimitRetry(url, {
    headers: { "X-Subscription-Token": env.BRAVE_API_KEY, accept: "application/json" },
    signal,
  }, { retries: 0, timeoutMs: parseTimeoutMs(env.SEARCH_TIMEOUT_MS, 5000) });
  if (!response.ok) throw new SearchProviderHttpError("Brave", response.status);
  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? []).flatMap((item): WebResult[] =>
    item.url ? [{ title: item.title ?? "", url: item.url, snippet: item.description ?? "" }] : [],
  );
};
