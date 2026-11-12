import type { Env, CoverCandidate } from "../types";
import { searchWeb, type ProviderName } from "./index";
import { fetchWithRateLimitRetry, parseTimeoutMs } from "./fetch";

function prioritizeAudiobookCovers(candidates: CoverCandidate[]): CoverCandidate[] {
  return candidates
    .map((candidate, index) => {
      const text = `${candidate.title} ${candidate.page_url ?? ""} ${candidate.snippet}`.toLowerCase();
      const audioEdition = /\b(audible|audiobook|audio\s*books?|audio edition|unabridged|narrated|narrator|spoken word|audio cd)\b/.test(text);
      const printEdition = /\b(paperback|hardcover|hardback|kindle|e-?book|ebook|softcover|mass[- ]market|print edition|print book)\b/.test(text);
      if (!audioEdition || printEdition) return null;
      let score = 10;
      if (candidate.width && candidate.height) score += candidate.height >= candidate.width ? 1 : -2;
      return { candidate, index, score };
    })
    .filter((entry): entry is { candidate: CoverCandidate; index: number; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

export async function searchCovers(
  query: string,
  env: Env,
  provider: ProviderName,
  mediaType: "audiobook" | "music" = "audiobook",
): Promise<{ provider: string; candidates: CoverCandidate[] }> {
  const braveApiKey = env.BRAVE_API_KEY;
  // Brave is the dedicated image source, independent of the selected web-search provider.
  if (braveApiKey) {
    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    const coverIntent = mediaType === "music"
      ? "album cover art"
      : 'audiobook Audible audio edition cover';
    url.searchParams.set("q", `${query} ${coverIntent}`);
    url.searchParams.set("count", String(Math.max(1, Math.min(Number(env.SEARCH_RESULT_LIMIT) || 8, 10))));
    const response = await fetchWithRateLimitRetry(url, {
      headers: { "X-Subscription-Token": braveApiKey, accept: "application/json" },
    }, { retries: 0, timeoutMs: parseTimeoutMs(env.SEARCH_TIMEOUT_MS, 5000) });
    if (!response.ok) throw new Error(`Brave image search returned HTTP ${response.status}`);
    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        page_fetched?: string;
        properties?: { url?: string; width?: number; height?: number };
        thumbnail?: { src?: string };
      }>;
    };
    const candidates: CoverCandidate[] = (data.results ?? []).flatMap((item) => {
      const imageUrl = item.properties?.url ?? item.thumbnail?.src;
      if (!imageUrl) return [];
      return [{
        title: item.title ?? "",
        image_url: imageUrl,
        page_url: item.url ?? item.page_fetched ?? null,
        snippet: "",
        width: item.properties?.width ?? null,
        height: item.properties?.height ?? null,
      }];
    });
    return {
      provider: "brave",
      candidates: mediaType === "audiobook" ? prioritizeAudiobookCovers(candidates) : candidates,
    };
  }

  const coverQuery = mediaType === "music"
    ? `${query} album cover artwork`
    : `${query} audiobook Audible audio edition cover image`;
  const { provider: usedProvider, results } = await searchWeb(coverQuery, env, provider);
  const candidates = results.map((item) => ({
    title: item.title,
    image_url: null,
    page_url: item.url,
    snippet: item.snippet,
    width: null,
    height: null,
  }));
  return {
    provider: usedProvider,
    candidates: mediaType === "audiobook" ? prioritizeAudiobookCovers(candidates) : candidates,
  };
}
