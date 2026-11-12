import type { Env, WebResult } from "../../types";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "../fetch";
import type { SearchAdapter } from "../index";
import { SearchProviderHttpError } from "../errors";

export const jinaSearch: SearchAdapter = async (query: string, env: Env, limit: number, signal?: AbortSignal) => {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (env.JINA_API_KEY) headers.authorization = `Bearer ${env.JINA_API_KEY}`;
  const response = await fetchWithRateLimitRetry("https://s.jina.ai/", {
    method: "POST",
    headers,
    body: JSON.stringify({ q: query, num: limit }),
    signal,
  }, { retries: 2, timeoutMs: parseTimeoutMs(env.SEARCH_TIMEOUT_MS, 8000) });
  if (!response.ok) throw new SearchProviderHttpError("Jina Search", response.status);
  const data = (await response.json()) as {
    data?: Array<{ title?: string; url?: string; content?: string; description?: string }>;
  };
  return (data.data ?? []).flatMap((item): WebResult[] =>
    item.url
      ? [{ title: item.title ?? "", url: item.url, snippet: item.content ?? item.description ?? "" }]
      : [],
  );
};
