import { afterEach, describe, expect, it, vi } from "vitest";
import { extractAudiobookMetadata } from "../src/metadata";
import type { CoverCandidate, WebResult } from "../src/types";

const sources: WebResult[] = [
  { title: "Book listing", url: "https://example.com/book", snippet: "Audiobook edition in Test Series, Book 2.5" },
];
const covers: CoverCandidate[] = [
  {
    title: "Project Hail Mary audiobook cover",
    image_url: "https://images.example.com/project-hail-mary.jpg",
    page_url: "https://example.com/book",
    snippet: "Cover artwork",
    width: 800,
    height: 800,
  },
];
const modelOutput = {
  query: "Project Hail Mary by Andy Weir",
  results: [{
    title: "Project Hail Mary",
    subtitle: null,
    description: "A lone astronaut attempts to save Earth from an extinction-level threat.",
    metadata: {
      primary_author: "Andy Weir",
      authors: ["Andy Weir"],
      narrators: ["Ray Porter"],
      publisher: "Audible Studios",
      publication_date: "2021-05-04",
      year: 2021,
      language: "English",
      duration: "16h 10m",
      isbn: null,
      asin: "B08GB58KD5",
      edition: "Unabridged",
      series: "Test Series",
      series_number: "2.5",
      genres: ["Science Fiction"],
      format: "Audiobook",
    },
    cover_art: {
      image_url: covers[0].image_url,
      thumbnail_url: covers[0].image_url,
      source_page_url: covers[0].page_url,
      alt_text: covers[0].title,
    },
    confidence: 0.93,
    sources: [{ title: "Book listing", url: "https://example.com/book", snippet: "Audiobook edition" }],
  }],
  message: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("extractAudiobookMetadata", () => {
  it("returns nested metadata and only selects cover art from search candidates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractAudiobookMetadata(
      "Project Hail Mary by Andy Weir",
      sources,
      covers,
      "brave",
      { OPENROUTER_API_KEY: "test-key" },
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(result.search_provider).toBe("brave");
    expect(result.cover_art_candidates[0].image_url).toBe(covers[0].image_url);
    expect(result.results[0].metadata.asin).toBe("B08GB58KD5");
    expect(result.results[0].metadata.primary_author).toBe("Andy Weir");
    expect(result.results[0].metadata.authors[0]).toBe("Andy Weir");
    expect(result.results[0].metadata.year).toBe(2021);
    expect(result.results[0].metadata.series).toBe("Test Series");
    expect(result.results[0].metadata.series_number).toBe(2.5);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.messages[0].content).toContain("Series is a high-priority field");
    expect(requestBody.messages[0].content).toContain("query and structured search hints are retrieval guidance");
    expect(result.results[0].cover_art?.image_url).toBe(covers[0].image_url);
  });

  it("defaults to Gemini 3.1 Flash Lite with an OpenRouter key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await extractAudiobookMetadata("Project Hail Mary", sources, covers, "brave", {
      OPENROUTER_API_KEY: "test-key",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model)
      .toBe("google/gemini-3.1-flash-lite");
  });

  it.each([404, 429, 503])("retries with the configured fallback model after HTTP %i", async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("primary unavailable", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(modelOutput) } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await extractAudiobookMetadata("Project Hail Mary", sources, covers, "brave", {
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_MODEL: "nvidia/nemotron-3-nano-30b-a3b:free",
      OPENROUTER_FALLBACK_MODEL: "openai/gpt-4o-mini",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("nvidia/nemotron-3-nano-30b-a3b:free");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("openai/gpt-4o-mini");
  });

  it("uses series details only when search evidence confirms them", async () => {
    const fabricated = structuredClone(modelOutput);
    fabricated.results[0].metadata.series = "Sun Eater Series";
    fabricated.results[0].metadata.series_number = 4;
    const noSeriesEvidence: WebResult[] = [{
      title: "Kingdoms of Death",
      url: "https://example.com/book",
      snippet: "An audiobook edition by Christopher Ruocchio.",
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(fabricated) } }],
    }), { status: 200 })));

    const result = await extractAudiobookMetadata(
      "Kingdoms of Death - Sun Eater Series, Book 4",
      noSeriesEvidence,
      covers,
      "brave",
      { OPENAI_API_KEY: "test-key" },
    );
    expect(result.results[0].metadata.series).toBeNull();
    expect(result.results[0].metadata.series_number).toBeNull();
  });

  it("repairs missing series fields from explicit search evidence", async () => {
    const incomplete = structuredClone(modelOutput);
    incomplete.results[0].metadata.series = "Sun Series";
    incomplete.results[0].metadata.series_number = null;
    const evidence: WebResult[] = [{
      title: "Kingdoms of Death (The Sun Eater Series, Book 4)",
      url: "https://example.com/book",
      snippet: "Kingdoms of Death is book 4 in the Sun Eater Series.",
    }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(incomplete) } }],
    }), { status: 200 })));

    const result = await extractAudiobookMetadata(
      "Kingdoms of Death - Sun Eater Series, Book 4",
      evidence,
      covers,
      "brave",
      { OPENAI_API_KEY: "test-key" },
    );
    expect(result.results[0].metadata.series).toBe("Sun Eater Series");
    expect(result.results[0].metadata.series_number).toBe(4);
  });

  it("moves ASINs out of ISBN and falls back to a verified cover candidate", async () => {
    const invalidOutput = structuredClone(modelOutput);
    invalidOutput.results[0].metadata.isbn = "B08GB58KD5";
    invalidOutput.results[0].metadata.asin = null;
    invalidOutput.results[0].cover_art!.image_url = "https://invented.example/cover.jpg";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(invalidOutput) } }],
    }), { status: 200 })));

    const result = await extractAudiobookMetadata("book", sources, covers, "brave", {
      OPENAI_API_KEY: "test-key",
    });

    expect(result.results[0].metadata.isbn).toBeNull();
    expect(result.results[0].metadata.asin).toBe("B08GB58KD5");
    expect(result.results[0].cover_art?.image_url).toBe(covers[0].image_url);
    expect(result.results[0].cover_art?.source_page_url).toBe(covers[0].page_url);
  });
});
