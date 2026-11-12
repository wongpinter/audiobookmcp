import { afterEach, describe, expect, it, vi } from "vitest";
import { parseModelJson } from "../src/model";
import { searchWeb } from "../src/search/index";
import { rankAndTrimSources } from "../src/trim";
import { buildCacheKey, getCachedValue, setCachedValue } from "../src/cache";
import { fetchWithRateLimitRetry } from "../src/search/fetch";
import type { WebResult } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips markdown fences", () => {
    expect(parseModelJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });
  it("extracts JSON from surrounding prose", () => {
    expect(parseModelJson("Here is the result: {\"a\":1} done")).toEqual({ a: 1 });
  });
});

describe("searchWeb single-provider selection", () => {
  it("uses only the preferred active provider in auto mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      web: { results: [{ title: "Dune audiobook", url: "https://example.com/brave", description: "Dune result" }] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("Dune by Frank Herbert", {
      EXA_API_KEY: "exa-key",
      BRAVE_API_KEY: "brave-key",
      JINA_API_KEY: "jina-key",
      FIRECRAWL_API_KEY: "fire-key",
    }, "auto");

    expect(result.provider).toBe("brave");
    expect(result.results[0].url).toBe("https://example.com/brave");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.search.brave.com");
  });

  it("uses one fallback provider when Brave is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ title: "Dune audiobook", url: "https://example.com/exa", text: "Dune result" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("Dune", { EXA_API_KEY: "exa-key" }, "auto");

    expect(result.provider).toBe("exa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back after a transient HTTP 500", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.search.brave.com") return new Response("unavailable", { status: 500 });
      if (url.hostname === "api.exa.ai") {
        return new Response(JSON.stringify({
          results: [{ title: "Dune audiobook", url: "https://example.com/exa", text: "Dune result" }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected host: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("Dune", {
      BRAVE_API_KEY: "brave-key",
      EXA_API_KEY: "exa-key",
    }, "auto");

    expect(result.provider).toBe("exa");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an explicitly requested provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ title: "Dune", url: "https://example.com/exa", text: "Dune" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("Dune", {
      BRAVE_API_KEY: "brave-key",
      EXA_API_KEY: "exa-key",
    }, "exa");

    expect(result.provider).toBe("exa");
    expect(String(fetchMock.mock.calls[0][0])).toContain("api.exa.ai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("rankAndTrimSources", () => {
  it("caps at 8 and prefers title matches, truncating long snippets", () => {
    const generic = Array.from({ length: 10 }, (_, i) => ({
      title: `Unrelated ${i}`,
      url: `https://example.com/generic-${i}`,
      snippet: "x".repeat(2000),
    } satisfies WebResult));
    const relevant: WebResult = {
      title: "Project Hail Mary by Andy Weir",
      url: "https://example.com/relevant",
      snippet: "y".repeat(2000),
    };
    const ranked = rankAndTrimSources("Project Hail Mary by Andy Weir", [...generic, relevant]);
    expect(ranked).toHaveLength(8);
    expect(ranked[0].url).toBe(relevant.url);
    expect(ranked[0].snippet.length).toBeLessThanOrEqual(601);
  });

  it("prefers the actual book over the author bio page for \"No Accident by Steven Havill\"", () => {
    const authorPage: WebResult = {
      title: "Steven Havill – Audio Books, Best Sellers, Author Bio | Audible.com",
      url: "https://www.audible.com/author/Steven-Havill/B001ITYKH6",
      snippet: "Browse Steven Havill's best-selling audiobooks and newest titles. Red, Green, or Murder Audiobook By Steven F. Havill cover art",
    };
    const bookPage: WebResult = {
      title: "No Accident (Posadas County Mystery, #25)",
      url: "https://www.goodreads.com/en/book/show/59058020-no-accident",
      snippet: "No Accident by Steven F. Havill is the latest installment in the Posadas County Mystery series",
    };
    const ranked = rankAndTrimSources("No Accident by Steven Havill", [authorPage, bookPage]);
    expect(ranked[0].url).toBe(bookPage.url);
  });
});

describe("fetchWithRateLimitRetry", () => {
  it("applies the timeout while consuming the response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      new ReadableStream({ pull: () => new Promise(() => undefined) }),
      { status: 200 },
    )));

    await expect(fetchWithRateLimitRetry("https://example.com", undefined, {
      retries: 0,
      timeoutMs: 20,
    })).rejects.toThrow("Request timed out after 20ms");
  });

  it("retries 503s then returns the final response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("try again", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await fetchWithRateLimitRetry("https://example.com", undefined, { retries: 1, timeoutMs: 5000 });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cache helpers", () => {
  it("no-op gracefully when Cache API is unavailable", async () => {
    expect(await getCachedValue(buildCacheKey("audiobook", "Dune", "auto"), {})).toBeNull();
    await expect(setCachedValue(buildCacheKey("audiobook", "Dune", "auto"), { ok: true }, {})).resolves.toBeUndefined();
  });
  it("builds normalized keys", () => {
    expect(buildCacheKey("audiobook", "  Dune  by   Frank Herbert ", "auto")).toBe(
      "https://audiobook-cache.internal/audiobook?q=dune%20by%20frank%20herbert&p=auto",
    );
  });
});
