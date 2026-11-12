import type { AudiobookSearchHints, AudiobookSearchInput, Env } from "./types";
import { extractAudiobookMetadata } from "./metadata";
import { extractMusicMetadata } from "./music";
import { searchWeb, type ProviderName } from "./search";
import { searchCovers } from "./search/covers";
import { AudiobookResponseSchema, CoverSearchResponseSchema, MusicResponseSchema } from "./types";
import { buildCacheKey, getCachedValue, setCachedValue } from "./cache";
import { rankAndTrimCovers, rankAndTrimSources } from "./trim";
import { analyzeQuery } from "./queryHints";

const GENERIC_AUTHOR_LABELS = new Set([
  "various",
  "various author",
  "various authors",
  "various artist",
  "various artists",
]);

function isGenericAuthorLabel(value?: string): boolean {
  return GENERIC_AUTHOR_LABELS.has((value ?? "").trim().toLowerCase());
}

export interface AudiobookSearchProgress {
  stage: string;
  message: string;
  provider?: string;
  source_count?: number;
  cover_count?: number;
  result_count?: number;
  elapsed_seconds?: number;
}

export type AudiobookProgressListener = (progress: AudiobookSearchProgress) => void;

function reportProgress(listener: AudiobookProgressListener | undefined, progress: AudiobookSearchProgress): void {
  try {
    listener?.(progress);
  } catch {
    // Progress delivery must never interrupt audiobook search.
  }
}

export async function searchAudiobook(
  input: string | AudiobookSearchInput,
  provider: ProviderName,
  env: Env,
  onProgress?: AudiobookProgressListener,
) {
  const request = typeof input === "string" ? { query: input } : input;
  const query = request.query.trim();
  const hints = request.hints;
  const cacheInput = JSON.stringify({ query, hints: hints ?? null });
  const cacheKey = buildCacheKey("audiobook-v7", cacheInput, provider);
  reportProgress(onProgress, { stage: "cache_lookup", message: "Checking cached results." });
  const cached = await getCachedValue<Awaited<ReturnType<typeof searchAudiobookUncached>>>(cacheKey, env);
  if (cached) {
    reportProgress(onProgress, { stage: "cache_hit", message: "Returning cached results.", result_count: cached.results.length });
    return cached;
  }
  reportProgress(onProgress, { stage: "cache_miss", message: "No cached result; starting live search." });
  const result = await searchAudiobookUncached(query, hints, provider, env, onProgress);
  if (!result.search_partial) await setCachedValue(cacheKey, result, env);
  return result;
}

async function searchAudiobookUncached(
  query: string,
  hints: AudiobookSearchHints | undefined,
  provider: ProviderName,
  env: Env,
  onProgress?: AudiobookProgressListener,
) {
  const totalStartedAt = performance.now();
  const queryAnalysis = analyzeQuery(query, hints);
  const title = hints?.title?.trim();
  const rawAuthor = hints?.author?.trim();
  const genericAuthor = isGenericAuthorLabel(rawAuthor);
  const author = genericAuthor ? "" : rawAuthor ?? "";
  const authors = (hints?.authors ?? []).filter((name) => !isGenericAuthorLabel(name));
  const authorHint = hints?.author_role === "narrator" ? "" : author;
  const narratorHint = hints?.narrator?.trim() ||
    (hints?.author_role === "narrator" ? author : "");
  const identityQuery = title
    ? `${title}${authorHint ? ` by ${authorHint}` : ""}`
    : authorHint && !query.toLowerCase().includes(`by ${authorHint.toLowerCase()}`)
      ? `${query} by ${authorHint}`
      : query;
  const metadataHints = hints
    ? {
        ...hints,
        author: genericAuthor ? undefined : hints.author,
        author_role: genericAuthor && hints.author_role === "author" ? undefined : hints.author_role,
        authors: hints.authors === undefined ? undefined : authors,
      }
    : undefined;
  const seriesName = hints?.series?.name?.trim() || queryAnalysis.series_name_hint || "";
  const seriesNumber = hints?.series?.number ?? queryAnalysis.book_number;
  const extraHints = [
    queryAnalysis.has_volume_hint ? "volume" : "",
    queryAnalysis.has_compilation_hint ? "compilation omnibus collection complete series" : "",
    queryAnalysis.has_series_hint ? "series" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mainSearchTerms = [
    identityQuery,
    authors.join(" "),
    seriesName,
    seriesNumber !== null && seriesNumber !== undefined ? `Book ${seriesNumber}` : "",
    narratorHint ? `narrator ${narratorHint}` : "",
    hints?.edition ?? "",
    hints?.format ?? "audiobook",
    extraHints,
    "series publisher ISBN edition",
  ].filter(Boolean).join(" ");
  reportProgress(onProgress, { stage: "search_started", message: "Searching audiobook sources and cover art." });
  let webSearchMs = 0;
  let coverSearchMs = 0;
  const webSearchStartedAt = performance.now();
  const mainSearchPromise = searchWeb(mainSearchTerms, env, provider).then((result) => {
    webSearchMs = performance.now() - webSearchStartedAt;
    reportProgress(onProgress, {
      stage: "web_search_complete",
      message: `Found ${result.results.length} search sources.`,
      provider: result.provider,
      source_count: result.results.length,
    });
    return result;
  });
  const coverQuery = [identityQuery, authors.join(" "), seriesName].filter(Boolean).join(" ");
  const coverSearchStartedAt = performance.now();
  const coverSearchPromise = searchCovers(coverQuery, env, provider)
    .then((result) => {
      coverSearchMs = performance.now() - coverSearchStartedAt;
      reportProgress(onProgress, {
        stage: "cover_search_complete",
        message: `Found ${result.candidates.length} audiobook cover candidates.`,
        provider: result.provider,
        cover_count: result.candidates.length,
      });
      return result;
    })
    .catch(() => {
      coverSearchMs = performance.now() - coverSearchStartedAt;
      reportProgress(onProgress, {
        stage: "cover_search_complete",
        message: "Cover search is unavailable; continuing with metadata search.",
        cover_count: 0,
      });
      return null;
    });
  const [search, coverSearch] = await Promise.all([mainSearchPromise, coverSearchPromise]);

  const sources = rankAndTrimSources(identityQuery, search.results);
  const coverCandidates = rankAndTrimCovers(coverSearch?.candidates ?? []);
  reportProgress(onProgress, { stage: "metadata_started", message: "Search evidence is ready; extracting audiobook metadata." });
  const modelStartedAt = performance.now();
  const progressTimer = onProgress
    ? setInterval(() => reportProgress(onProgress, {
        stage: "metadata_in_progress",
        message: "Still extracting audiobook metadata.",
        elapsed_seconds: Math.floor((performance.now() - modelStartedAt) / 1000),
      }), 5000)
    : undefined;
  let extracted: Awaited<ReturnType<typeof extractAudiobookMetadata>>;
  try {
    extracted = await extractAudiobookMetadata(
      query,
      sources,
      coverCandidates,
      search.provider,
      env,
      queryAnalysis,
      metadataHints,
    );
  } finally {
    if (progressTimer) clearInterval(progressTimer);
  }
  reportProgress(onProgress, {
    stage: "metadata_complete",
    message: `Metadata extraction returned ${extracted.results.length} results.`,
    result_count: extracted.results.length,
  });
  console.log(JSON.stringify({
    event: "audiobook_search_timing",
    provider: search.provider,
    web_search_ms: Math.round(webSearchMs),
    cover_search_ms: Math.round(coverSearchMs),
    model_ms: Math.round(performance.now() - modelStartedAt),
    total_ms: Math.round(performance.now() - totalStartedAt),
    source_count: sources.length,
    cover_count: coverCandidates.length,
    result_count: extracted.results.length,
  }));
  return AudiobookResponseSchema.parse({
    ...extracted,
    search_partial: search.partial,
  });
}

export async function searchMusic(query: string, provider: ProviderName, env: Env) {
  const cacheKey = buildCacheKey("music", query, provider);
  const cached = await getCachedValue<Awaited<ReturnType<typeof searchMusicUncached>>>(cacheKey, env);
  if (cached) return cached;
  const result = await searchMusicUncached(query, provider, env);
  await setCachedValue(cacheKey, result, env);
  return result;
}

async function searchMusicUncached(query: string, provider: ProviderName, env: Env) {
  const queryAnalysis = analyzeQuery(query);
  const extraHints = [
    queryAnalysis.has_volume_hint ? "volume" : "",
    queryAnalysis.has_compilation_hint ? "compilation collection" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const searchPromise = searchWeb(
    `${query} ${extraHints} song track album artist release date genre ISRC label`,
    env,
    provider,
  );
  const coverSearchPromise = searchCovers(query, env, provider, "music").catch(() => null);
  const [search, coverSearch] = await Promise.all([searchPromise, coverSearchPromise]);

  const sources = rankAndTrimSources(query, search.results);
  const coverCandidates = rankAndTrimCovers(coverSearch?.candidates ?? []);
  const extracted = await extractMusicMetadata(
    query,
    sources,
    coverCandidates,
    search.provider,
    env,
    queryAnalysis,
  );
  return MusicResponseSchema.parse(extracted);
}

export async function searchAudiobookCovers(query: string, provider: ProviderName, env: Env) {
  const cacheKey = buildCacheKey("audiobook-covers-v2", query, provider);
  const cached = await getCachedValue<Awaited<ReturnType<typeof searchAudiobookCoversUncached>>>(cacheKey, env);
  if (cached) return cached;
  const result = await searchAudiobookCoversUncached(query, provider, env);
  await setCachedValue(cacheKey, result, env);
  return result;
}

async function searchAudiobookCoversUncached(query: string, provider: ProviderName, env: Env) {
  const result = await searchCovers(query, env, provider);
  return CoverSearchResponseSchema.parse({
    query,
    search_provider: result.provider,
    candidates: result.candidates,
  });
}
