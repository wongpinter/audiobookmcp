import { describe, it, expect } from "vitest";
import { analyzeQuery } from "../src/queryHints";

describe("analyzeQuery series detection", () => {
  it("detects book number", () => {
    const result = analyzeQuery("Monster's Mercy Book 3 by William D Arand");
    expect(result.has_series_hint).toBe(true);
    expect(result.book_number).toBe(3);
    expect(result.has_volume_hint).toBe(false);
    expect(result.has_compilation_hint).toBe(false);
  });

  it("detects fractional book number", () => {
    const result = analyzeQuery("Mistborn Book 2.5");
    expect(result.book_number).toBe(2.5);
  });

  it("detects volume", () => {
    const result = analyzeQuery("Dune Vol. 2");
    expect(result.has_volume_hint).toBe(true);
    expect(result.volume_number).toBe(2);
  });

  it("detects compilation / omnibus", () => {
    expect(analyzeQuery("The Hobbit compilation").has_compilation_hint).toBe(true);
    expect(analyzeQuery("Lord of the Rings omnibus").has_compilation_hint).toBe(true);
    expect(analyzeQuery("Complete works box set").has_compilation_hint).toBe(true);
  });

  it("detects bare series mention", () => {
    const result = analyzeQuery("Atomic Habits series");
    expect(result.has_series_hint).toBe(true);
    expect(result.book_number).toBeNull();
  });

  it("detects book number and series name for dash queries", () => {
    const result = analyzeQuery("Kingdoms of Death - Sun Eater Series, Book 4");
    expect(result.book_number).toBe(4);
    expect(result.has_series_hint).toBe(true);
    expect(result.series_name_hint).toMatch(/sun eater/i);
  });

  it("uses structured series name and number as retrieval hints", () => {
    const result = analyzeQuery("1:35 AM", {
      series: { name: "Five Nights at Freddy's: Fazbear Frights", number: 3 },
    });
    expect(result.has_series_hint).toBe(true);
    expect(result.series_name_hint).toBe("Five Nights at Freddy's: Fazbear Frights");
    expect(result.book_number).toBe(3);
  });

  it("returns no hints for plain title", () => {
    const result = analyzeQuery("Atomic Habits by James Clear");
    expect(result.has_series_hint).toBe(false);
    expect(result.has_volume_hint).toBe(false);
    expect(result.has_compilation_hint).toBe(false);
    expect(result.hint_summary).toBeNull();
  });
});
