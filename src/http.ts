import { searchAudiobook, searchAudiobookCovers, searchMusic, type AudiobookSearchProgress } from "./service";
import { AudiobookSearchHintsSchema, type AudiobookSearchHints, type AudiobookSearchInput, type Env } from "./types";
import type { ProviderName } from "./search";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function audiobookProgressResponse(input: string | AudiobookSearchInput, provider: ProviderName, env: Env): Response {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      send("state", { stage: "accepted", message: "Request accepted." });
      const onProgress = (progress: AudiobookSearchProgress) => send("state", progress);
      void searchAudiobook(input, provider, env, onProgress)
        .then((result) => {
          send("state", {
            stage: "complete",
            message: "Search completed.",
            result_count: Array.isArray(result.results) ? result.results.length : 0,
          });
          send("result", result);
          finish();
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : "Unexpected search error";
          send("failure", { error: "Search failed", detail });
          finish();
        });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseProvider(value: unknown): ProviderName | null {
  if (value === undefined || value === "auto") return "auto";
  return value === "exa" || value === "brave" || value === "firecrawl" ? value : null;
}

export async function handleHttpApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const isAudiobook = url.pathname === "/api/audiobook";
  const isMusic = url.pathname === "/api/music";
  const isCovers = url.pathname === "/api/covers";
  if (!isAudiobook && !isMusic && !isCovers) return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Use GET or POST for this endpoint." }, 405);
  }

  let query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
  let providerValue: unknown = url.searchParams.get("provider") ?? undefined;
  let hints: AudiobookSearchHints | undefined;
  let streamRequested = isAudiobook && ["1", "true"].includes((url.searchParams.get("stream") ?? "").toLowerCase());
  if (request.method === "POST") {
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "Request body must be a JSON object." }, 400);
      }
      const payload = body as { query?: unknown; q?: unknown; provider?: unknown; hints?: unknown; stream?: unknown };
      const bodyQuery = payload.query ?? payload.q;
      if (isAudiobook && payload.stream === true) streamRequested = true;
      if (typeof bodyQuery === "string") query = bodyQuery;
      providerValue = payload.provider ?? providerValue;
      if (isAudiobook && payload.hints !== undefined) {
        const parsedHints = AudiobookSearchHintsSchema.safeParse(payload.hints);
        if (!parsedHints.success) {
          return json({ error: "Invalid audiobook hints.", issues: parsedHints.error.issues }, 400);
        }
        hints = parsedHints.data;
      }
    } catch {
      return json({ error: "Request body must contain valid JSON." }, 400);
    }
  }

  query = query.trim();
  if (query.length < 2) return json({ error: "Provide a query with at least 2 characters." }, 400);
  if (providerValue === "jina") {
    return json({ error: "Jina Search is temporarily disabled while its quota is exhausted." }, 400);
  }
  const provider = parseProvider(providerValue);
  if (!provider) return json({ error: "provider must be auto, exa, brave, or firecrawl." }, 400);

  try {
    if (isAudiobook && streamRequested) {
      return audiobookProgressResponse(hints ? { query, hints } : query, provider, env);
    }
    const result = isAudiobook
      ? await searchAudiobook(hints ? { query, hints } : query, provider, env)
      : isMusic
        ? await searchMusic(query, provider, env)
        : await searchAudiobookCovers(query, provider, env);
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected search error";
    return json({ error: "Search failed", detail: message }, 502);
  }
}
