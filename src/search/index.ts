import type { Env, WebResult } from "../types";
import { exaSearch } from "./providers/exa";
import { braveSearch } from "./providers/brave";
import { firecrawlSearch } from "./providers/firecrawl";
import { isRetryableSearchProviderError, SearchProviderHttpError } from "./errors";

export type ProviderName = "auto" | "exa" | "brave" | "firecrawl";
export type SearchAdapter = (query: string, env: Env, limit: number, signal?: AbortSignal) => Promise<WebResult[]>;

const adapters: Record<Exclude<ProviderName, "auto">, SearchAdapter> = {
  exa: exaSearch,
  brave: braveSearch,
  firecrawl: firecrawlSearch,
};

// Jina is temporarily excluded while its search quota is exhausted.
const AUTO_ORDER: Exclude<ProviderName, "auto">[] = ["brave", "exa", "firecrawl"];

function isActive(name: Exclude<ProviderName, "auto">, env: Env): boolean {
  switch (name) {
    case "exa":
      return Boolean(env.EXA_API_KEY);
    case "brave":
      return Boolean(env.BRAVE_API_KEY);
    case "firecrawl":
      return Boolean(env.FIRECRAWL_API_KEY);
  }
}

function providerOrder(env: Env, requested: ProviderName): Exclude<ProviderName, "auto">[] {
  if (requested !== "auto") return [requested];
  if (env.SEARCH_PROVIDER && env.SEARCH_PROVIDER !== "auto") {
    const configured = env.SEARCH_PROVIDER;
    if (configured === "jina") throw new Error("Jina Search is temporarily disabled while its quota is exhausted.");
    if (configured === "exa" || configured === "brave" || configured === "firecrawl") return [configured];
    throw new Error(`Unsupported SEARCH_PROVIDER: ${configured}`);
  }
  const active = AUTO_ORDER.filter((name) => isActive(name, env));
  if (!active.length) {
    throw new Error("No search providers are configured. Set BRAVE_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY.");
  }
  return active;
}

export async function searchWeb(
  query: string,
  env: Env,
  requested: ProviderName = "auto",
): Promise<{ provider: string; results: WebResult[]; partial: boolean }> {
  const limit = Math.max(1, Math.min(Number(env.SEARCH_RESULT_LIMIT) || 8, 10));
  const order = providerOrder(env, requested);

  const canFallback = requested === "auto" && (!env.SEARCH_PROVIDER || env.SEARCH_PROVIDER === "auto");
  let lastError: unknown;
  for (let index = 0; index < order.length; index += 1) {
    const name = order[index];
    try {
      const results = await adapters[name](query, env, limit);
      if (results.length) return { provider: name, results, partial: false };
      throw new Error(`${name}: returned no results`);
    } catch (error) {
      lastError = error;
      const nextProvider = order[index + 1];
      if (!canFallback || !nextProvider || !isRetryableSearchProviderError(error)) break;
      console.warn(JSON.stringify({
        event: "search_provider_fallback",
        from: name,
        to: nextProvider,
        status: error instanceof SearchProviderHttpError ? error.status : undefined,
      }));
    }
  }
  throw new Error(
    `Search providers failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
