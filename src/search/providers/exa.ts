import type { Env, WebResult } from "../../types";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "../fetch";
import type { SearchAdapter } from "../index";
import { SearchProviderHttpError } from "../errors";

export const exaSearch: SearchAdapter = async (query: string, env: Env, limit: number, signal?: AbortSignal) => {
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY is not configured");
  const response = await fetchWithRateLimitRetry("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.EXA_API_KEY },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: limit,
      contents: { text: { maxCharacters: 800 } },
    }),
    signal,
  }, { retries: 2, timeoutMs: parseTimeoutMs(env.SEARCH_TIMEOUT_MS, 8000) });
  if (!response.ok) throw new SearchProviderHttpError("Exa", response.status);
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
  return (data.results ?? []).flatMap((item): WebResult[] =>
    item.url ? [{ title: item.title ?? "", url: item.url, snippet: item.text ?? "" }] : [],
  );
};
