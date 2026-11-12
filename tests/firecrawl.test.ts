import { afterEach, describe, expect, it, vi } from "vitest";
import { firecrawlSearch } from "../src/search/providers/firecrawl";

afterEach(() => vi.unstubAllGlobals());

describe("Firecrawl search adapter", () => {
  it("calls Firecrawl Search v2 and maps web results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        web: [{
          title: "Audiobook listing",
          url: "https://example.com/audiobook",
          description: "A narrated audiobook edition.",
        }],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await firecrawlSearch("book audiobook", { FIRECRAWL_API_KEY: "test-key" }, 5);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.firecrawl.dev/v2/search");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      query: "book audiobook",
      limit: 5,
    });
    expect(results).toEqual([{
      title: "Audiobook listing",
      url: "https://example.com/audiobook",
      snippet: "A narrated audiobook edition.",
    }]);
  });

  it("requires a configured API key", async () => {
    await expect(firecrawlSearch("book", {}, 5)).rejects.toThrow("FIRECRAWL_API_KEY is not configured");
  });
});
