import { z } from "zod";

// Query-side check for series / compilation / volume markers. The result is
// used as explicit evidence: it steers search terms, is passed to the model
// as a hint, and is returned in the response so callers can see the check
// result without re-parsing the query themselves.

export const QueryAnalysisSchema = z.object({
  has_series_hint: z.boolean().default(false),
  has_compilation_hint: z.boolean().default(false),
  has_volume_hint: z.boolean().default(false),
  book_number: z.union([z.number(), z.string()]).nullable().default(null),
  volume_number: z.number().nullable().default(null),
  series_name_hint: z.string().nullable().default(null),
  hint_summary: z.string().nullable().default(null),
});

export type QueryAnalysis = z.infer<typeof QueryAnalysisSchema>;

function toNumber(value: string | undefined): number | string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function analyzeQuery(
  query: string,
  structuredHints?: {
    series?: { name?: string; number?: number | string };
  },
): QueryAnalysis {
  const text = query.trim();
  const lower = text.toLowerCase();

  let bookNumber: number | string | null = null;
  let volumeNumber: number | null = null;
  let hasSeriesHint = false;
  let hasVolumeHint = false;
  let hasCompilationHint = false;

  const parts: string[] = [];

  // "Book 3", "Book #3", "Book No. 3", "Book 2.5"
  const bookMatch = lower.match(/\bbook\s*(?:no\.?\s*|#\s*)?(\d+(?:\.\d+)?)\b/);
  if (bookMatch) {
    bookNumber = toNumber(bookMatch[1]);
    hasSeriesHint = true;
    parts.push(`series/book hint (book ${bookMatch[1]})`);
  }

  // "#3" and "No. 3" — only count when not already a book number.
  if (bookNumber === null) {
    const hashMatch = lower.match(/[#](\d+(?:\.\d+)?)\b/) ?? lower.match(/\bno\.\s*(\d+(?:\.\d+)?)\b/);
    if (hashMatch) {
      const precededByBookContext = lower.includes("book") || lower.includes("series") || lower.includes("#");
      if (precededByBookContext) {
        bookNumber = toNumber(hashMatch[1]);
        hasSeriesHint = true;
        parts.push(`series order hint (${hashMatch[1]})`);
      }
    }
  }

  // "Volume 2", "Vol. 2", "Vol 2"
  const volumeMatch = lower.match(/\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?)\b/);
  if (volumeMatch) {
    const parsed = Number(volumeMatch[1]);
    volumeNumber = Number.isFinite(parsed) ? parsed : null;
    hasVolumeHint = true;
    parts.push(`volume hint (vol ${volumeMatch[1]})`);
  }

  // "Part 2" / "Part III" style — treat as series/volume order evidence.
  const partMatch = lower.match(/\bpart\s*(?:no\.?\s*|#\s*)?([ivx\d]+(?:\.\d+)?)\b/);
  if (partMatch && bookNumber === null && volumeNumber === null) {
    const raw = partMatch[1].trim();
    if (/^\d/.test(raw)) {
      bookNumber = toNumber(raw);
      hasSeriesHint = true;
      parts.push(`part hint (part ${raw})`);
    }
  }

  // Explicit series patterns without a number: "Series Name, Book ..."
  // is already covered; a bare trailing "in series" also counts.
  if (!hasSeriesHint && /\bseries\b/.test(lower)) {
    hasSeriesHint = true;
    if (!parts.some((p) => p.includes("series"))) parts.push("mentions series");
  }

  // Compilation / omnibus / collection / box set / complete works.
  if (/\b(compilation|omnibus|collection|box\s*set|complete\s+(?:works|series|set|edition)|volumes?\s*1\s*[-\u2013]\s*\d+|books?\s*1\s*[-\u2013]\s*\d+)\b/.test(lower)) {
    hasCompilationHint = true;
    parts.push("compilation/omnibus/collection hint");
  }

  // Series name mentioned in the query, e.g. "Kingdoms of Death - Sun Eater
  // Series, Book 4" -> "Sun Eater Series". Capture the text before the
  // word "Series".
  let seriesNameHint: string | null = null;
  const seriesNameMatch =
    text.match(/-\s*([^,()]+?)\s+Series\b/i) ??
    text.match(/\(\s*([^,()]+?)\s+Series\b/i) ??
    text.match(/^[^,()]+?\s+([^,()]+?)\s+Series\b/i);
  if (seriesNameMatch) {
    seriesNameHint = `${seriesNameMatch[1].trim().replace(/[-–—,]+$/g, "").trim()} Series`.trim();
    if (seriesNameHint && seriesNameHint.toLowerCase() !== "series") {
      hasSeriesHint = true;
      if (!parts.some((p) => p.includes(seriesNameHint!.slice(0, 8)))) {
        parts.push(`series name hint (${seriesNameHint})`);
      }
    } else {
      seriesNameHint = null;
    }
  }

  const structuredSeries = structuredHints?.series;
  if (structuredSeries?.name?.trim()) {
    seriesNameHint = structuredSeries.name.trim();
    hasSeriesHint = true;
    parts.push(`structured series name hint (${seriesNameHint})`);
  }
  if (structuredSeries?.number !== undefined) {
    bookNumber = structuredSeries.number;
    hasSeriesHint = true;
    parts.push(`structured series order hint (${structuredSeries.number})`);
  }

  return QueryAnalysisSchema.parse({
    has_series_hint: hasSeriesHint,
    has_compilation_hint: hasCompilationHint,
    has_volume_hint: hasVolumeHint,
    book_number: bookNumber,
    volume_number: volumeNumber,
    series_name_hint: seriesNameHint,
    hint_summary: parts.length ? `Query contains ${parts.join(", ")}.` : null,
  });
}
