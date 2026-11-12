import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAudiobook } from "../src/service";

afterEach(() => vi.unstubAllGlobals());

describe("searchAudiobook contributor hints", () => {
  it("ignores a generic primary-author label and searches with known contributors", async () => {
    const webQueries: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/web/search")) {
        webQueries.push(url.searchParams.get("q") ?? "");
        return new Response(JSON.stringify({
          web: { results: [{
            title: "Dark Fantasies by Chris Morgan",
            url: "https://example.com/dark-fantasies",
            description: "Dark Fantasies by Chris Morgan",
          }] },
        }), { status: 200 });
      }
      if (url.pathname.endsWith("/images/search")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/chat/completions")) {
        const request = JSON.parse(String(init?.body));
        const modelInput = JSON.parse(request.messages[1].content);
        expect(modelInput.search_hints.author).toBeUndefined();
        expect(modelInput.search_hints.authors).toEqual(["Chris Morgan"]);
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            query: "Dark Fantasies",
            results: [{
              title: "Dark Fantasies",
              metadata: { primary_author: "Chris Morgan", authors: ["Chris Morgan"] },
              confidence: 0.9,
              sources: [{
                title: "Dark Fantasies by Chris Morgan",
                url: "https://example.com/dark-fantasies",
                snippet: "Dark Fantasies by Chris Morgan",
              }],
            }],
          }) } }],
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const progressStages: string[] = [];
    const result = await searchAudiobook({
      query: "Dark Fantasies",
      hints: {
        title: "Dark Fantasies",
        author: "Various Authors",
        author_role: "author",
        authors: ["Chris Morgan"],
        format: "audiobook",
      },
    }, "brave", {
      BRAVE_API_KEY: "test-key",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_MODEL: "test-model",
    }, (progress) => progressStages.push(progress.stage));

    expect(result.results[0].metadata.primary_author).toBe("Chris Morgan");
    expect(progressStages).toContain("search_started");
    expect(progressStages).toContain("web_search_complete");
    expect(progressStages).toContain("cover_search_complete");
    expect(progressStages).toContain("metadata_started");
    expect(progressStages).toContain("metadata_complete");
    expect(webQueries).toHaveLength(1);
    expect(webQueries.every((query) => !query.includes("Various Authors"))).toBe(true);
    expect(webQueries.some((query) => query.includes("Chris Morgan"))).toBe(true);
  });
});
