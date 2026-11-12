import { afterEach, describe, expect, it, vi } from "vitest";
import { searchCovers } from "../src/search/covers";

afterEach(() => vi.unstubAllGlobals());

describe("searchCovers", () => {
  it("searches for album artwork for music queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await searchCovers("Night Drive by Example Artist", { BRAVE_API_KEY: "test-key" }, "brave", "music");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("q")).toBe("Night Drive by Example Artist album cover art");
  });

  it("prioritizes audiobook audio-edition covers over print-cover results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          title: "Paperback book cover",
          url: "https://store.example/paperback",
          properties: { url: "https://images.example/print.jpg", width: 400, height: 600 },
        },
        {
          title: "Audible Audiobook Audio Edition",
          url: "https://audible.example/audiobook",
          properties: { url: "https://images.example/audio.jpg", width: 400, height: 600 },
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCovers("Dark Fantasies by Chris Morgan", { BRAVE_API_KEY: "test-key" }, "auto");
    const url = new URL(String(fetchMock.mock.calls[0][0]));

    expect(url.searchParams.get("q")).toContain("audiobook Audible audio edition cover");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].image_url).toBe("https://images.example/audio.jpg");
  });

  it("drops print-only image results for audiobook searches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        title: "Dark Fantasies edited by Chris Morgan, 1989 paperback",
        url: "https://books.example/dark-fantasies-paperback",
        properties: { url: "https://images.example/print.jpg", width: 400, height: 600 },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCovers("Dark Fantasies by Chris Morgan", { BRAVE_API_KEY: "test-key" }, "auto");

    expect(result.candidates).toEqual([]);
  });

  it("filters print results when using a web provider for audiobook covers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { web: [
        { title: "Dark Fantasies 1989 paperback", url: "https://books.example/print", description: "Print edition" },
        { title: "Dark Fantasies audiobook", url: "https://audible.example/audio", description: "Unabridged audio edition" },
      ] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCovers("Dark Fantasies", { FIRECRAWL_API_KEY: "test-key" }, "firecrawl");

    expect(result.provider).toBe("firecrawl");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].page_url).toBe("https://audible.example/audio");
  });

  it("uses Brave image results for cover art with any selected web provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        title: "Audiobook cover",
        url: "https://audible.example/book",
        properties: { url: "https://images.example/cover.jpg", width: 500, height: 500 },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCovers(
      "Dune by Frank Herbert",
      { BRAVE_API_KEY: "test-key" },
      "firecrawl",
    );

    expect(String(fetchMock.mock.calls[0][0])).toContain("/images/search");
    expect(result.provider).toBe("brave");
    expect(result.candidates[0]).toMatchObject({
      image_url: "https://images.example/cover.jpg",
      page_url: "https://audible.example/book",
      width: 500,
      height: 500,
    });
  });
});
