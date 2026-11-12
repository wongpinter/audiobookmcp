import { afterEach, describe, expect, it, vi } from "vitest";
import { extractMusicMetadata } from "../src/music";
import { searchMusic } from "../src/service";
import type { CoverCandidate, WebResult } from "../src/types";

const sources: WebResult[] = [
  { title: "Track listing", url: "https://example.com/track", snippet: "Album and track details" },
];
const covers: CoverCandidate[] = [
  {
    title: "Album artwork",
    image_url: "https://images.example.com/album.jpg",
    page_url: "https://example.com/album",
    snippet: "Official artwork",
    width: 800,
    height: 800,
  },
];
const modelOutput = {
  query: "Night Drive by Example Artist",
  results: [{
    type: "track",
    title: "Night Drive",
    metadata: {
      primary_artist: "Example Artist",
      artists: ["Example Artist", "Guest Artist"],
      album: "Midnight",
      release_date: "2020-04-15",
      year: 2019,
      track_number: "3",
      disc_number: 1,
      duration_ms: "214000",
      genres: ["Electronic"],
      label: "Example Records",
      isrc: "USAAA2000001",
      upc: null,
      composers: ["Composer One"],
      producers: ["Producer One"],
      explicit: false,
      format: "Music",
    },
    tracklist: [],
    cover_art: { image_url: "https://untrusted.example/art.jpg" },
    confidence: 0.91,
    sources: [{ title: "Track listing", url: "https://example.com/track", snippet: "Album and track details" }],
  }],
  message: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("extractMusicMetadata", () => {
  it("searches web evidence and album artwork through the shared provider pipeline", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/web/search")) {
        return new Response(JSON.stringify({ web: { results: [{
          title: "Night Drive track listing",
          url: "https://example.com/track",
          description: "Track from Midnight by Example Artist",
        }] } }), { status: 200 });
      }
      if (url.pathname.endsWith("/images/search")) {
        expect(url.searchParams.get("q")).toContain("album cover art");
        return new Response(JSON.stringify({ results: [{
          title: "Midnight album artwork",
          url: "https://example.com/album",
          properties: { url: covers[0].image_url, width: 800, height: 800 },
        }] }), { status: 200 });
      }
      expect(url.pathname).toBe("/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.messages[1].content).toContain("Night Drive");
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelOutput) } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchMusic("Night Drive by Example Artist", "brave", {
      BRAVE_API_KEY: "brave-test-key",
      OPENROUTER_API_KEY: "model-test-key",
    });

    expect(result.search_provider).toBe("brave");
    expect(result.cover_art_candidates[0].image_url).toBe(covers[0].image_url);
    expect(result.results[0].cover_art?.image_url).toBe(covers[0].image_url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("accepts a single result object when the model omits the results array", async () => {
    const singleResultOutput = { ...modelOutput, results: modelOutput.results[0] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(singleResultOutput) } }],
    }), { status: 200 })));

    const result = await extractMusicMetadata("Night Drive", sources, covers, "brave", {
      OPENROUTER_API_KEY: "test-key",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Night Drive");
  });

  it("normalizes track metadata and selects artwork only from supplied candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractMusicMetadata(
      "Night Drive by Example Artist",
      sources,
      covers,
      "brave",
      { OPENROUTER_API_KEY: "test-key" },
    );

    expect(result.results[0].type).toBe("track");
    expect(result.results[0].metadata.primary_artist).toBe("Example Artist");
    expect(result.results[0].metadata.artists).toEqual(["Example Artist", "Guest Artist"]);
    expect(result.results[0].metadata.year).toBe(2020);
    expect(result.results[0].metadata.track_number).toBe(3);
    expect(result.results[0].metadata.duration_ms).toBe(214000);
    expect(result.results[0].cover_art?.image_url).toBe(covers[0].image_url);
  });
});
