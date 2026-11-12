import type { CoverCandidate, WebResult } from "./types";

const MAX_SOURCES = 8;
const MAX_SNIPPET_CHARS = 600;
const MAX_COVERS = 5;

// Service-layer suffix terms that describe the search intent, not the book
// itself. Excluding them keeps relevance ranking focused on title/author.
const STOPWORDS = new Set([
  "audiobook", "book", "books", "series", "name", "number", "author", "authors",
  "narrator", "isbn", "asin", "publisher", "edition", "description", "order",
  "goodreads", "song", "track", "tracks", "album", "albums", "artist", "artists",
  "release", "date", "genre", "genres", "isrc", "label", "cover", "covers",
  "image", "images", "art", "artwork", "audio", "music", "by", "the", "and",
  "with", "from", "for", "a", "an", "of", "in", "on", "is",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => (token.length >= 2 || /^\d+$/.test(token)) && !STOPWORDS.has(token));
}

interface ParsedQuery {
  titleTokens: string[];
  authorTokens: string[];
  titlePhrase: string;
}

// Split "Title by Author" so title closeness outweighs author matches.
// A bare author page (e.g. "Steven Havill – Audio Books, Author Bio")
// otherwise outscores the actual "No Accident" book page. Also keeps
// short title words like "no" ("No Accident") that a len>=3 filter drops.
export function parseQuery(query: string): ParsedQuery {
  const byMatch = query.split(/\bby\b/i);
  if (byMatch.length >= 2) {
    const titlePart = byMatch[0];
    const authorPart = byMatch.slice(1).join(" by ");
    const titleTokens = tokenize(titlePart);
    const authorTokens = tokenize(authorPart);
    return { titleTokens, authorTokens, titlePhrase: titlePart.trim().toLowerCase() };
  }
  // "Kingdoms of Death - Sun Eater Series, Book 4": the main title is
  // before the dash; the remainder is series/book detail, not title.
  const dashSplit = query.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    const titlePart = dashSplit[0];
    const rest = dashSplit.slice(1).join(" - ");
    const digitTokens = tokenize(rest).filter((t) => /^\d+$/.test(t));
    const titleTokens = Array.from(new Set([...tokenize(titlePart), ...digitTokens]));
    return { titleTokens, authorTokens: [], titlePhrase: titlePart.trim().toLowerCase() };
  }
  const tokens = tokenize(query);
  return { titleTokens: tokens, authorTokens: [], titlePhrase: query.trim().toLowerCase() };
}

function queryTokens(query: string): string[] {
  const parsed = parseQuery(query);
  return [...parsed.titleTokens, ...parsed.authorTokens];
}

const AUTHORITY_DOMAINS = [
  "audible.",
  "goodreads.",
  "google.",
  "wikipedia.",
  "penguinrandomhouse.",
  "harpercollins.",
  "simonandschuster.",
  "hachette",
  "overdrive.",
  "libby.",
  "library",
];

function authorityBonus(url: string): number {
  const lower = url.toLowerCase();
  return AUTHORITY_DOMAINS.some((domain) => lower.includes(domain)) ? 2 : 0;
}

export function scoreSource(source: WebResult, tokens: string[]): number {
  // Backwards-compatible shim: treat all tokens as title tokens.
  return scoreParsed(source, { titleTokens: tokens, authorTokens: [], titlePhrase: tokens.join(" ") });
}

function authorPagePenalty(source: WebResult): number {
  const url = source.url.toLowerCase();
  const title = source.title.toLowerCase();
  const markers = [
    "/author/",
    "author bio",
    "best sellers, author bio",
    "browse audiobooks",
    "browse audiobooks -",
  ];
  return markers.some((m) => url.includes(m) || title.includes(m)) ? -12 : 0;
}

export function scoreParsed(source: WebResult, parsed: ParsedQuery): number {
  const { titleTokens, authorTokens, titlePhrase } = parsed;
  if (titleTokens.length === 0 && authorTokens.length === 0) return 0;
  const title = source.title.toLowerCase();
  const snippet = source.snippet.toLowerCase();
  let score = 0;

  let titleTitleMatches = 0;
  let titleSnippetMatches = 0;
  for (const token of titleTokens) {
    if (title.includes(token)) { score += 6; titleTitleMatches += 1; }
    if (snippet.includes(token)) { score += 1.2; titleSnippetMatches += 1; }
  }
  let authorTitleMatches = 0;
  let authorSnippetMatches = 0;
  for (const token of authorTokens) {
    if (title.includes(token)) { score += 1; authorTitleMatches += 1; }
    if (snippet.includes(token)) { score += 0.3; authorSnippetMatches += 1; }
  }

  if (titleTokens.length) {
    score += (titleTitleMatches / titleTokens.length) * 8;
    score += (titleSnippetMatches / titleTokens.length) * 2;
  }
  if (authorTokens.length) {
    score += (authorTitleMatches / authorTokens.length) * 1.5;
    score += (authorSnippetMatches / authorTokens.length) * 0.5;
  }

  // Exact title phrase in the result title is the strongest signal.
  const phrase = titlePhrase.trim();
  if (phrase && phrase.length >= 3 && title.includes(phrase)) score += 10;
  if (phrase && title.trimStart().startsWith(phrase.split(/\s+/)[0])) score += 2;
  if (title.trimStart().startsWith(titleTokens[0])) score += 1;

  score += authorityBonus(source.url);
  score += authorPagePenalty(source);
  return score;
}

function truncate(snippet: string, maxChars: number): string {
  if (snippet.length <= maxChars) return snippet;
  return `${snippet.slice(0, maxChars).trimEnd()}…`;
}

// Rank sources by closeness to the query: title tokens (before "by") weigh
// far more than author tokens, an exact title phrase in the result title
// is the strongest signal, and author bio pages are penalized. Returns the
// top maxSources with truncated snippets.
export function rankAndTrimSources(query: string, sources: WebResult[], maxSources = MAX_SOURCES): WebResult[] {
  const parsed = parseQuery(query);
  const scored = sources.map((source, index) => ({
    source: { ...source, snippet: truncate(source.snippet, MAX_SNIPPET_CHARS) },
    score: scoreParsed(source, parsed),
    index,
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, maxSources).map((entry) => entry.source);
}

// Fuse results from multiple providers: dedupe by URL, reward URLs returned
// by several providers (consensus = closeness signal), rank by closeness,
// and return the top `limit` closest unique results.
export function fuseResults(
  query: string,
  perProvider: Array<{ provider: string; results: WebResult[] }>,
  limit: number,
): { providers: string[]; results: WebResult[] } {
  const parsed = parseQuery(query);
  const byUrl = new Map<string, { source: WebResult; score: number; count: number; index: number }>();
  const providers: string[] = [];
  let globalIndex = 0;
  for (const entry of perProvider) {
    if (entry.results.length && !providers.includes(entry.provider)) providers.push(entry.provider);
    for (const result of entry.results) {
      const base = scoreParsed(result, parsed);
      const existing = byUrl.get(result.url);
      if (!existing || base > existing.score) {
        byUrl.set(result.url, {
          source: result,
          score: Math.max(base, existing?.score ?? base),
          count: (existing?.count ?? 0) + 1,
          index: existing?.index ?? globalIndex,
        });
      } else {
        // Consensus bonus is applied once after pooling, so keep the best
        // base score here and only grow the provider count.
        existing.count += 1;
        existing.score = Math.max(existing.score, base);
      }
      globalIndex += 1;
    }
  }
  const fused = [...byUrl.values()];
  for (const entry of fused) {
    entry.score += (entry.count - 1) * 4;
  }
  fused.sort((a, b) => b.score - a.score || a.index - b.index);
  const results = fused.slice(0, limit).map((entry) => ({
    ...entry.source,
    snippet: truncate(entry.source.snippet, MAX_SNIPPET_CHARS),
  }));
  return { providers, results };
}

export function rankAndTrimCovers(candidates: CoverCandidate[], maxCovers = MAX_COVERS): CoverCandidate[] {
  return candidates.slice(0, maxCovers);
}

export function trimSourcesForModel(sources: WebResult[]): WebResult[] {
  return sources.slice(0, MAX_SOURCES).map((source) => ({
    ...source,
    snippet: truncate(source.snippet, MAX_SNIPPET_CHARS),
  }));
}
