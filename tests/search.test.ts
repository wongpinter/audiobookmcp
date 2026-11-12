import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWeb } from "../src/search";

afterEach(() => vi.unstubAllGlobals());

describe("searchWeb provider fallback", () => {
  it("falls back serially from Brave after a 429 in auto mode", async () => {
    const requestUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestUrls.push(url.hostname);
      if (url.hostname === "api.search.brave.com") return new Response("rate limited", { status: 429 });
      if (url.hostname === "api.exa.ai") {
        return new Response(JSON.stringify({
          results: [{ title: "Audiobook result", url: "https://example.com/audio", text: "audio edition" }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected host: ${url.hostname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("Audiobook title", {
      BRAVE_API_KEY: "test-key",
      EXA_API_KEY: "exa-key",
      JINA_API_KEY: "quota-exhausted-key",
      SEARCH_PROVIDER: "auto",
      SEARCH_TIMEOUT_MS: "100",
    });

    expect(result.provider).toBe("exa");
    expect(result.results[0].url).toBe("https://example.com/audio");
    expect(requestUrls).toEqual(["api.search.brave.com", "api.exa.ai"]);
  });

  it("does not call Jina when it is the only configured search key", async () => {
    await expect(searchWeb("Audiobook title", { JINA_API_KEY: "quota-exhausted-key" }))
      .rejects.toThrow("No search providers are configured");
  });

  it("rejects Jina as an environment-selected provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("Audiobook title", { SEARCH_PROVIDER: "jina" }))
      .rejects.toThrow("Jina Search is temporarily disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fallback for non-retryable provider errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("Audiobook title", {
      BRAVE_API_KEY: "test-key",
      SEARCH_PROVIDER: "auto",
      SEARCH_TIMEOUT_MS: "100",
    })).rejects.toThrow("Brave returned HTTP 401");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors an explicitly selected provider without fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchWeb("Audiobook title", {
      BRAVE_API_KEY: "test-key",
      SEARCH_PROVIDER: "auto",
      SEARCH_TIMEOUT_MS: "100",
    }, "brave")).rejects.toThrow("Brave returned HTTP 429");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
