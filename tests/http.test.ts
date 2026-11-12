import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleHttpApi } from "../src/http";
import { searchAudiobook } from "../src/service";

vi.mock("../src/service", () => ({
  searchAudiobook: vi.fn(async (
    input: string | { query: string },
    _provider: string,
    _env: object,
    onProgress?: (progress: { stage: string; message: string }) => void,
  ) => {
    onProgress?.({ stage: "search_started", message: "Searching sources." });
    return { query: typeof input === "string" ? input : input.query };
  }),
  searchAudiobookCovers: vi.fn(async () => ({})),
  searchMusic: vi.fn(async () => ({})),
}));

describe("HTTP API routes", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns a useful validation error for missing search queries", async () => {
    const response = await handleHttpApi(new Request("https://worker.test/api/audiobook"), {});
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "Provide a query with at least 2 characters." });
  });

  it("recognizes the music API route and validates its query", async () => {
    const response = await handleHttpApi(new Request("https://worker.test/api/music"), {});
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "Provide a query with at least 2 characters." });
  });

  it("rejects Jina as a temporarily disabled HTTP provider", async () => {
    const response = await handleHttpApi(
      new Request("https://worker.test/api/covers?q=Dune&provider=jina"),
      {},
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: "Jina Search is temporarily disabled while its quota is exhausted.",
    });
  });

  it("streams state events and the final result when opted in", async () => {
    const response = await handleHttpApi(
      new Request("https://worker.test/api/audiobook?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Dune", stream: true }),
      }),
      {},
    );

    expect(response?.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response?.text();
    expect(body).toContain('event: state\ndata: {"stage":"accepted"');
    expect(body).toContain('"stage":"search_started"');
    expect(body).toContain('event: result\ndata: {"query":"Dune"}');
    expect(searchAudiobook).toHaveBeenCalledWith("Dune", "auto", {}, expect.any(Function));
  });

  it("accepts structured audiobook hints over POST", async () => {
    const hints = {
      title: "1:35 AM",
      author: "Scott Cawthon",
      author_role: "author",
      series: { name: "Five Nights at Freddy's: Fazbear Frights", number: 3 },
      format: "audiobook",
    };
    const response = await handleHttpApi(
      new Request("https://worker.test/api/audiobook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Fazbear Frights book 3", hints, provider: "brave" }),
      }),
      {},
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({ query: "Fazbear Frights book 3" });
    expect(searchAudiobook).toHaveBeenCalledWith(
      { query: "Fazbear Frights book 3", hints },
      "brave",
      {},
    );
  });

  it("rejects malformed structured audiobook hints", async () => {
    const response = await handleHttpApi(
      new Request("https://worker.test/api/audiobook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "Fazbear Frights book 3",
          hints: { series: { name: "Fazbear Frights", number: 0 } },
        }),
      }),
      {},
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "Invalid audiobook hints." });
    expect(searchAudiobook).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods", async () => {
    const response = await handleHttpApi(
      new Request("https://worker.test/api/covers", { method: "DELETE" }),
      {},
    );
    expect(response?.status).toBe(405);
  });
});
