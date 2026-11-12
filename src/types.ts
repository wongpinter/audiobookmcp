import { z } from "zod";
import { QueryAnalysisSchema } from "./queryHints";

export interface Env {
  SEARCH_PROVIDER?: string;
  MCP_BEARER_TOKEN?: string;
  EXA_API_KEY?: string;
  BRAVE_API_KEY?: string;
  JINA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  SEARCH_RESULT_LIMIT?: string;
  SEARCH_TIMEOUT_MS?: string;
  MODEL_TIMEOUT_MS?: string;
  CACHE_ENABLED?: string;
  CACHE_TTL_SECONDS?: string;
}

export const AudiobookSearchHintsSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  authors: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  author_role: z.enum(["author", "narrator"]).optional(),
  narrator: z.string().trim().min(1).max(200).optional(),
  series: z.object({
    name: z.string().trim().min(1).max(200),
    number: z.union([
      z.number().finite().positive(),
      z.string().trim().min(1).max(40),
    ]).optional(),
  }).strict().optional(),
  edition: z.string().trim().min(1).max(100).optional(),
  format: z.enum(["audiobook", "ebook", "print"]).optional(),
  identifiers: z.object({
    isbn: z.string().trim().min(1).max(32).optional(),
    asin: z.string().trim().min(1).max(32).optional(),
  }).strict().optional(),
}).strict();

export type AudiobookSearchHints = z.infer<typeof AudiobookSearchHintsSchema>;

export interface AudiobookSearchInput {
  query: string;
  hints?: AudiobookSearchHints;
}

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().default(""),
});

export const AudiobookMetadataSchema = z.object({
  primary_author: z.string().nullable().default(null),
  authors: z.array(z.string()).default([]),
  narrators: z.array(z.string()).default([]),
  publisher: z.string().nullable().default(null),
  publication_date: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  language: z.string().nullable().default(null),
  duration: z.string().nullable().default(null),
  isbn: z.string().nullable().default(null),
  asin: z.string().nullable().default(null),
  edition: z.string().nullable().default(null),
  series: z.string().nullable().default(null),
  series_number: z.union([z.number(), z.string()]).nullable().default(null),
  has_series: z.boolean().default(false),
  genres: z.array(z.string()).default([]),
  format: z.string().nullable().default("Audiobook"),
});

export const CoverArtSchema = z.object({
  image_url: z.string().url(),
  thumbnail_url: z.string().url().nullable().default(null),
  source_page_url: z.string().url().nullable().default(null),
  alt_text: z.string().nullable().default(null),
});

export const AudiobookSchema = z.object({
  title: z.string(),
  subtitle: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  metadata: AudiobookMetadataSchema,
  cover_art: CoverArtSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
  sources: z.array(SourceSchema).default([]),
});

export const AudiobookResponseSchema = z.object({
  query: z.string(),
  query_analysis: QueryAnalysisSchema.default({
    has_series_hint: false,
    has_compilation_hint: false,
    has_volume_hint: false,
    book_number: null,
    volume_number: null,
    series_name_hint: null,
    hint_summary: null,
  }),
  search_provider: z.string(),
  search_partial: z.boolean().default(false),
  cover_art_candidates: z.array(z.object({
    title: z.string(),
    image_url: z.string().url().nullable(),
    page_url: z.string().url().nullable(),
    snippet: z.string().default(""),
    width: z.number().nullable().default(null),
    height: z.number().nullable().default(null),
  })).default([]),
  results: z.array(AudiobookSchema).default([]),
  message: z.string().nullable().default(null),
});

export const MusicTracklistItemSchema = z.object({
  title: z.string(),
  artists: z.array(z.string()).default([]),
  track_number: z.number().int().nullable().default(null),
  duration_ms: z.number().int().nullable().default(null),
});

export const MusicMetadataSchema = z.object({
  primary_artist: z.string().nullable().default(null),
  artists: z.array(z.string()).default([]),
  album: z.string().nullable().default(null),
  release_date: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  track_number: z.number().int().nullable().default(null),
  disc_number: z.number().int().nullable().default(null),
  duration_ms: z.number().int().nullable().default(null),
  genres: z.array(z.string()).default([]),
  label: z.string().nullable().default(null),
  isrc: z.string().nullable().default(null),
  upc: z.string().nullable().default(null),
  composers: z.array(z.string()).default([]),
  producers: z.array(z.string()).default([]),
  explicit: z.boolean().nullable().default(null),
  format: z.string().nullable().default("Music"),
});

export const MusicResultSchema = z.object({
  type: z.enum(["track", "album"]),
  title: z.string(),
  metadata: MusicMetadataSchema,
  tracklist: z.array(MusicTracklistItemSchema).default([]),
  cover_art: CoverArtSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
  sources: z.array(SourceSchema).default([]),
});

export const MusicResponseSchema = z.object({
  query: z.string(),
  query_analysis: QueryAnalysisSchema.default({
    has_series_hint: false,
    has_compilation_hint: false,
    has_volume_hint: false,
    book_number: null,
    volume_number: null,
    series_name_hint: null,
    hint_summary: null,
  }),
  search_provider: z.string(),
  cover_art_candidates: z.array(z.object({
    title: z.string(),
    image_url: z.string().url().nullable(),
    page_url: z.string().url().nullable(),
    snippet: z.string().default(""),
    width: z.number().nullable().default(null),
    height: z.number().nullable().default(null),
  })).default([]),
  results: z.array(MusicResultSchema).default([]),
  message: z.string().nullable().default(null),
});

export const CoverCandidateSchema = z.object({
  title: z.string(),
  image_url: z.string().url().nullable(),
  page_url: z.string().url().nullable(),
  snippet: z.string().default(""),
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
});

export const CoverSearchResponseSchema = z.object({
  query: z.string(),
  search_provider: z.string(),
  candidates: z.array(CoverCandidateSchema).default([]),
});

export type CoverCandidate = z.infer<typeof CoverCandidateSchema>;

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}
