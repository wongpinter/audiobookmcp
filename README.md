# Audiobook Discovery

A stateless audiobook and music search service deployed as a TypeScript Cloudflare Worker. It exposes the same search functionality through remote MCP and a simple JSON HTTP API. Responses are cached in the Cloudflare Cache API so repeat queries return in milliseconds without re-calling search or model APIs.

Client setup, request/response schemas, authentication, and integration examples are documented in the [Client Integration Guide](docs/CLIENT_INTEGRATION.md).

## Capabilities

- `search_audiobook`: structured audiobook metadata, edition details, description, selected cover art, alternate cover candidates, and source citations.
- `search_music`: structured track or album metadata, selected album artwork, tracklists when available, and source citations.
- `search_audiobook_cover`: direct artwork URLs where available, source pages, and image dimensions.
- HTTP API routes for clients that cannot use MCP.
- Pluggable search adapters; add future providers under `src/search/providers/` and register them in `src/search/index.ts`.

## Endpoints

Example deployment: `https://audiobook-discovery-mcp.sugeng-doyle.workers.dev`. This URL belongs to the maintainer-managed Worker; use the URL printed by Wrangler for deployments under your account.

| Method | Path | Purpose |
| --- | --- | --- |
| GET or POST | `/api/audiobook` | Search and normalize audiobook details; POST supports opt-in SSE state progress with `stream: true` |
| GET or POST | `/api/music` | Search and normalize music tracks or albums |
| GET or POST | `/api/covers` | Find audiobook cover art |
| GET | `/health` | Service health check |
| MCP Streamable HTTP | `/mcp` | MCP server endpoint |

REST routes accept `query` (or `q`) and optional `provider` values: `auto`, `exa`, `brave`, or `firecrawl`. GET uses query parameters; POST uses a JSON body. Audiobook POST requests can also include structured `hints` for the title, author role, narrator, series/order, edition, format, and identifiers. Hints guide retrieval; returned metadata includes source citations for client review. Set the `MCP_BEARER_TOKEN` secret before deployment to require `Authorization: Bearer <token>` on API and MCP routes. When the secret is absent, those routes are publicly callable; `/health` remains public either way. Keep the token in Wrangler secrets or a trusted backend, never in source control or a mobile app.

```sh
curl -X POST 'https://audiobook-discovery-mcp.sugeng-doyle.workers.dev/api/audiobook' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  --data-binary @- <<'JSON'
{
  "query": "Five Nights at Freddy's: Fazbear Frights, Book 3: 1:35 AM",
  "provider": "auto",
  "hints": {
    "title": "1:35 AM",
    "author": "Scott Cawthon",
    "author_role": "author",
    "series": { "name": "Five Nights at Freddy's: Fazbear Frights", "number": 3 },
    "format": "audiobook"
  }
}
JSON
```

```sh
export TOKEN='your-mcp-bearer-token'

curl --get 'https://audiobook-discovery-mcp.sugeng-doyle.workers.dev/api/audiobook' \
  --data-urlencode 'query=Project Hail Mary by Andy Weir' \
  --data-urlencode 'provider=brave' \
  -H "Authorization: Bearer ${TOKEN}"

curl -X POST 'https://audiobook-discovery-mcp.sugeng-doyle.workers.dev/api/covers' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"query":"Project Hail Mary by Andy Weir","provider":"brave"}'
```

Example music request:

```sh
curl --get 'https://audiobook-discovery-mcp.sugeng-doyle.workers.dev/api/music' \
  --data-urlencode 'query=Night Drive by Example Artist' \
  -H "Authorization: Bearer ${TOKEN}"
```

The music JSON response includes `query`, `search_provider`, `cover_art_candidates`, and `results`. Each result has `type` (`track` or `album`), `title`, `metadata`, `tracklist`, selected `cover_art`, `confidence`, and `sources`. Metadata includes `primary_artist`, all `artists`, album, release date and integer year, track/disc numbers, duration in milliseconds, genres, label, ISRC, UPC, composers, producers, explicit flag, and format.

The audiobook JSON response includes `query`, `search_provider`, `cover_art_candidates`, and `results`. Each result contains `title`, `description`, nested `metadata`, selected `cover_art`, `confidence`, and `sources`. Metadata includes `primary_author`, all `authors` (primary author first), `narrators`, publisher, publication date, integer `year`, language, duration, ISBN, ASIN, edition, series, `series_number` (numeric orders return as numbers, including fractions; labeled orders remain strings), genres, and format. The fields support audiobook tagging and display integrations.

## Search providers

- `exa` — configured with `EXA_API_KEY`.
- `brave` — configured with `BRAVE_API_KEY`; also provides direct cover-image candidates.
- `firecrawl` — configured with `FIRECRAWL_API_KEY` and uses Firecrawl Search API v2.
- Jina Search is temporarily disabled while its key quota is exhausted; the HTTP and MCP provider options exclude it.
- `auto` — tries active providers serially in this order: Brave, Exa, Firecrawl. It starts with one provider and advances only after HTTP 408, 429, or 5xx; explicit `provider` values stay pinned to the requested backend.

## Search & response optimizations

- **Fast retrieval**: one combined title/author/series web query and a dedicated cover-image query run concurrently; auto mode uses serial provider fallback only on transient HTTP failures. Search result count is capped at 5.
- **Audiobook cover targeting**: image search asks for audiobook, Audible, and audio-edition covers; only candidates with audio-edition evidence are returned, and print/ebook candidates are excluded.
- **Timeouts & retries**: provider and model timeouts cover response-body reads; Brave web/image requests make one attempt, while auto web search advances to another provider after transient HTTP failures. Model calls use the configured fallback model after errors or timeouts.
- **Robust JSON parsing**: fenced or preamble-wrapped model JSON is tolerated and parsed.
- **Relevance-ranked evidence**: sources are ranked by closeness to the query — title token hits weigh most, snippet hits add context, and authoritative domains (Audible, Goodreads, publishers) break ties. The top 8 evidence sources are sent to the LLM; cover candidates are capped at 5.
- **Response caching**: keyed on `(endpoint, query, provider, hints)` via the Cloudflare Cache API, TTL `CACHE_TTL_SECONDS` (default 86400). Partial audiobook responses are skipped. Set `CACHE_ENABLED=false` to disable.

## Model configuration

OpenRouter is supported directly through `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. OpenAI-compatible APIs can use `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.

The Worker uses `google/gemini-3.1-flash-lite` as its OpenRouter primary model and retries once with `openai/gpt-4.1-mini` after a primary provider error or timeout. Configure these with `OPENROUTER_MODEL` and `OPENROUTER_FALLBACK_MODEL`. OpenRouter defaults to `https://openrouter.ai/api/v1`; direct OpenAI defaults to `https://api.openai.com/v1`.

## Secrets

Set Worker secrets with Wrangler; values are entered securely at the prompt:

```sh
npx wrangler secret put EXA_API_KEY
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put MCP_BEARER_TOKEN
```

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in local credentials. `.dev.vars` is gitignored.

## Develop and deploy

Node.js and npm are used for the documented workflow; `package-lock.json` is the npm lockfile.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Add provider and model API keys to the ignored .dev.vars file.
npm run dev
npm test
npm run typecheck
```

For deployment, authenticate Wrangler, add secrets, then deploy:

```sh
npx wrangler login
npx wrangler secret put MCP_BEARER_TOKEN
npx wrangler secret put BRAVE_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
npm run deploy
```

Add other search-provider secrets when enabling those providers. The Worker is configured in `wrangler.jsonc`; `.dev.vars` is local-only and ignored by Git. No license file is included; choose one before granting reuse or redistribution rights. The repository also has no CI workflow yet; run `npm test` and `npm run typecheck` before releases.
