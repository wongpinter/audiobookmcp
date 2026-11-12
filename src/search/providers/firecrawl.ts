import type { Env, WebResult } from "../../types";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "../fetch";
import type { SearchAdapter } from "../index";
import { SearchProviderHttpError } from "../errors";

export const firecrawlSearch: SearchAdapter = async (query: string, env: Env, limit: number, signal?: AbortSignal) => {
  if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is not configured");
  const response = await fetchWithRateLimitRetry("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      sources: [{ type: "web" }],
    }),
    signal,
  }, { retries: 2, timeoutMs: parseTimeoutMs(env.SEARCH_TIMEOUT_MS, 8000) });
  if (!response.ok) throw new SearchProviderHttpError("Firecrawl", response.status);
  const payload = (await response.json()) as {
    success?: boolean;
    data?: {
      web?: Array<{ title?: string; url?: string; description?: string; markdown?: string }>;
    };
  };
  if (payload.success === false) throw new Error("Firecrawl search reported failure");
  return (payload.data?.web ?? []).flatMap((item): WebResult[] =>
    item.url
      ? [{
          title: item.title ?? "",
          url: item.url,
          snippet: item.description ?? item.markdown ?? "",
        }]
      : [],
  );
};
