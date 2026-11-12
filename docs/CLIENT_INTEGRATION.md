# Client integration guide

This guide describes how Swaradhara and other applications can call the Audiobook Discovery Worker over HTTP. The deployed base URL is `https://audiobook-discovery-mcp.sugeng-doyle.workers.dev`.

## Audiobook search

Use `POST /api/audiobook` when you have structured metadata. The plain-text query remains required; structured hints add context for retrieval.

```http
POST /api/audiobook
Content-Type: application/json
```

When authentication is enabled, include the configured token in the `Authorization` request header.

```json
{
  "query": "1:35 AM Five Nights at Freddy's: Fazbear Frights by Scott Cawthon",
  "provider": "auto",
  "hints": {
    "title": "1:35 AM",
    "author": "Scott Cawthon",
    "author_role": "author",
    "series": {
      "name": "Five Nights at Freddy's: Fazbear Frights",
      "number": 3
    },
    "format": "audiobook"
  }
}
```

### Request fields

- `query` (required): at least two characters. Include useful title, series, order, author, or other search terms.
- `provider` (optional): `auto` (default), `exa`, `brave`, or `firecrawl`. Jina is temporarily disabled while its search quota is exhausted.
- `hints` (optional): structured audiobook clues. Every hint is optional.
  - `title`: expected book title.
  - `author`: a known primary author or name described by `author_role`.
  - `authors`: optional array of known book authors/contributors, useful for anthologies or when the primary author field is generic.
  - `author_role`: `author` or `narrator`.
  - `narrator`: known narrator name.
  - `series`: `{ "name": string, "number"?: number | string }`.
  - `edition`: edition clue such as `Unabridged`.
  - `format`: `audiobook`, `ebook`, or `print`.
  - `identifiers`: optional `{ "isbn"?: string, "asin"?: string }`.

Send only fields the app knows. Hints guide retrieval; the Worker uses search-source evidence to establish returned metadata. Unknown hint keys are rejected, so clients should omit unsupported fields. The schema accepts `authors` as book-contributor clues; it has no separate `album_artists` hint. Treat audio album-artist tags as contributor metadata, not as a primary author.

When the primary-author field contains a placeholder such as `Various Authors` or `Various Artists`, omit `author` and pass any known contributors through `authors`. Pass a narrator separately. The response returns evidence-supported contributors in `metadata.authors`; a collection may have no single main author.

### Legacy requests

Existing query-only requests remain supported:

```http
GET /api/audiobook?query=Project%20Hail%20Mary%20by%20Andy%20Weir&provider=brave
```

```json
{ "query": "Project Hail Mary by Andy Weir", "provider": "brave" }
```

The JSON body above can be sent with `POST /api/audiobook`. Structured POST is preferred when the caller has metadata to provide. GET requests cannot carry structured hints.

## Audiobook progress stream

POST `/api/audiobook` with `"stream": true` in the JSON body, or add `?stream=1`. The response uses Server-Sent Events (`text/event-stream`) and sends only state changes plus the final validated result; it does not stream model text. Existing requests without the stream flag keep the regular JSON response.

```sh
curl -N -X POST 'https://audiobook-discovery-mcp.sugeng-doyle.workers.dev/api/audiobook' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  --data '{"query":"The Last Human","provider":"auto","hints":{"title":"The Last Human","format":"audiobook"},"stream":true}'
```

Events use `event: state` with JSON `data` for stages such as `accepted`, `cache_lookup`, `cache_hit`, `cache_miss`, `search_started`, `web_search_complete`, `cover_search_complete`, `metadata_started`, `metadata_in_progress` (every five seconds while extraction runs), `metadata_complete`, and `complete`. Completion sends `event: result` with the same JSON object as the non-streaming endpoint; failures send `event: failure`. A failure after the stream opens arrives as an SSE event, so the HTTP status may remain 200.

### Swaradhara client requirements

- Opt into progress on audiobook searches by sending `"stream": true` in the POST JSON body.
- Consume the response body as a byte stream, decode UTF-8 incrementally, and parse complete SSE frames separated by blank lines. Network chunks can split a frame or contain multiple frames.
- For `state` events, decode the JSON `data` and display its `message` as search status. Treat stages as status labels, not percentages or reliable ETA; web and cover searches run concurrently and can finish in either order.
- On `result`, decode the normal audiobook response, update the result UI, and end the progress state. On `failure`, show the supplied error and end the progress state.
- Keep the current JSON response flow for requests that do not opt into SSE. Handle `cache_hit` as a fast completion path; a cache hit can skip live-search and metadata stages.
- Never expect or display model-generated token text: the stream contains process states and the final structured result only.

## Audiobook response

A successful response has this shape (metadata values may be `null` or empty when evidence is unavailable):

```json
{
  "query": "1:35 AM by Scott Cawthon",
  "query_analysis": {
    "has_series_hint": true,
    "has_compilation_hint": false,
    "has_volume_hint": false,
    "book_number": 3,
    "volume_number": null,
    "series_name_hint": "Five Nights at Freddy's: Fazbear Frights",
    "hint_summary": "book 3; series Five Nights at Freddy's: Fazbear Frights"
  },
  "search_provider": "brave",
  "search_partial": false,
  "cover_art_candidates": [],
  "results": [
    {
      "title": "1:35 AM",
      "subtitle": null,
      "description": "...",
      "metadata": {
        "primary_author": "Scott Cawthon",
        "authors": ["Scott Cawthon"],
        "narrators": [],
        "publisher": null,
        "publication_date": null,
        "year": null,
        "language": null,
        "duration": null,
        "isbn": null,
        "asin": null,
        "edition": null,
        "series": "Five Nights at Freddy's: Fazbear Frights",
        "series_number": 3,
        "has_series": true,
        "genres": [],
        "format": "Audiobook"
      },
      "cover_art": null,
      "confidence": 0.9,
      "sources": [
        { "title": "Publisher page", "url": "https://example.com/book", "snippet": "..." }
      ]
    }
  ],
  "message": null
}
```

Top-level fields include `query`, `query_analysis`, `search_provider`, `search_partial`, `cover_art_candidates`, `results`, and `message`. Each audiobook result includes title, subtitle, description, metadata, selected `cover_art`, `confidence` from 0 to 1, and source citations. Metadata includes `primary_author`, `authors`, `narrators`, publisher, publication date, year, language, duration, ISBN, ASIN, edition, series, series number, `has_series`, genres, and format. A cover object includes `image_url`, `thumbnail_url`, `source_page_url`, and `alt_text`.

`search_partial` remains in the response for compatibility. Auto mode starts with one active provider and advances serially only after transient HTTP failures; each audiobook lookup uses one combined web query, plus a separate audiobook-cover image query. Treat `results` as a list: it can be empty or contain multiple candidates. Use `sources` to review metadata provenance and let the user choose when identity is uncertain. Confidence is a ranking signal, not a substitute for checking title and author. The Worker grounds returned metadata in its search evidence; request hints alone do not establish facts.

## Authentication and errors

When `MCP_BEARER_TOKEN` is configured, include its value in the `Authorization` request header. Keep the secret in a trusted server-side environment or backend proxy; mobile apps should call through that backend rather than package a long-lived Worker credential.

Typical errors are JSON objects with an `error` field:

- `400`: malformed JSON, query too short, invalid provider, or invalid/unknown audiobook hint fields.
- `401`: missing or invalid bearer token when authentication is enabled.
- `405`: unsupported HTTP method.
- `502`: search failure.

The endpoint supports CORS for `GET`, `POST`, and `OPTIONS`; allowed request headers include `Authorization` and `Content-Type`.

## Other HTTP routes

- `POST /api/music`: accepts `query` and optional `provider`; music response metadata includes `primary_artist` and `artists`.
- `POST /api/covers`: accepts `query` and optional `provider`; returns cover candidates.
- `GET /health`: service health check.

Both `/api/music` and `/api/covers` also support legacy GET query parameters. Audiobook `hints` apply only to `/api/audiobook`.
