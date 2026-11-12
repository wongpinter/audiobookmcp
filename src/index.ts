import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { handleHttpApi } from "./http";
import { searchAudiobook, searchAudiobookCovers, searchMusic } from "./service";
import {
  AudiobookResponseSchema,
  AudiobookSearchHintsSchema,
  CoverSearchResponseSchema,
  MusicResponseSchema,
  type Env,
} from "./types";

function createServer(env: Env) {
  const server = new McpServer({ name: "audiobook-discovery", version: "0.4.0" });

  server.registerTool(
    "search_audiobook",
    {
      description:
        "Search the web for an audiobook edition and return structured metadata, a grounded description, cover art, and citations.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Audiobook title, author, narrator, or ISBN"),
        hints: AudiobookSearchHintsSchema.optional(),
        provider: z.enum(["auto", "exa", "brave", "firecrawl"]).default("auto"),
      }),
      outputSchema: AudiobookResponseSchema,
    },
    async ({ query, hints, provider }) => {
      const output = await searchAudiobook(hints ? { query, hints } : query, provider, env);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "search_music",
    {
      description:
        "Search for a music track or album and return structured artist, release, track, artwork, and citation metadata.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Track or album title, artist, or catalog identifier"),
        provider: z.enum(["auto", "exa", "brave", "firecrawl"]).default("auto"),
      }),
      outputSchema: MusicResponseSchema,
    },
    async ({ query, provider }) => {
      const output = await searchMusic(query, provider, env);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "search_audiobook_cover",
    {
      description:
        "Find audiobook cover artwork, returning direct image URLs when the selected provider supplies them, with source pages and dimensions.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Audiobook title and author, preferably with edition"),
        provider: z.enum(["auto", "exa", "brave", "firecrawl"]).default("auto"),
      }),
      outputSchema: CoverSearchResponseSchema,
    },
    async ({ query, provider }) => {
      const output = await searchAudiobookCovers(query, provider, env);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ status: "ok", service: "audiobook-discovery" });
    }
    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (env.MCP_BEARER_TOKEN && request.headers.get("authorization") !== `Bearer ${env.MCP_BEARER_TOKEN}`) {
      return request.url.includes("/api/")
        ? Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Access-Control-Allow-Origin": "*" } })
        : new Response("Unauthorized", { status: 401 });
    }
    const apiResponse = await handleHttpApi(request, env);
    if (apiResponse) return apiResponse;
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
};
