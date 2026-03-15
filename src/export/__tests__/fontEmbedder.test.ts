import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KATEX_FONTS,
  getKaTeXFontFiles,
  generateLocalFontCSS,
  generateEmbeddedFontCSS,
  getKaTeXFontCSS,
  getUserFontFile,
  getGoogleFontUrl,
  contentHasMath,
  downloadFont,
  fontDataToDataUri,
} from "../fontEmbedder";
import type { FontFile, EmbeddedFont } from "../fontEmbedder";

/**
 * Tests for fontEmbedder — font embedding and deduplication logic.
 *
 * Issue #103 removed duplicate KaTeX font embedding code. These tests verify
 * that the deduplicated code still works correctly and that no duplicate
 * @font-face entries are produced.
 */

// ---------------------------------------------------------------------------
// KATEX_FONTS constant
// ---------------------------------------------------------------------------
describe("KATEX_FONTS", () => {
  it("is a non-empty array of font names", () => {
    expect(KATEX_FONTS.length).toBeGreaterThan(0);
  });

  it("contains no duplicate entries", () => {
    const unique = new Set(KATEX_FONTS);
    expect(unique.size).toBe(KATEX_FONTS.length);
  });

  it("all entries are non-empty strings", () => {
    for (const name of KATEX_FONTS) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("includes expected core KaTeX fonts", () => {
    expect(KATEX_FONTS).toContain("KaTeX_Main-Regular");
    expect(KATEX_FONTS).toContain("KaTeX_Main-Bold");
    expect(KATEX_FONTS).toContain("KaTeX_Math-Italic");
  });

  it("includes size variant fonts", () => {
    expect(KATEX_FONTS).toContain("KaTeX_Size1-Regular");
    expect(KATEX_FONTS).toContain("KaTeX_Size2-Regular");
    expect(KATEX_FONTS).toContain("KaTeX_Size3-Regular");
    expect(KATEX_FONTS).toContain("KaTeX_Size4-Regular");
  });

  it("has exactly 8 fonts", () => {
    expect(KATEX_FONTS.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// getKaTeXFontFiles
// ---------------------------------------------------------------------------
describe("getKaTeXFontFiles", () => {
  it("returns an array of FontFile objects", () => {
    const files = getKaTeXFontFiles();
    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it("each entry has required FontFile properties", () => {
    const files = getKaTeXFontFiles();
    for (const f of files) {
      expect(f.family).toBeDefined();
      expect(f.filename).toBeDefined();
      expect(f.url).toBeDefined();
      expect(f.weight).toBeDefined();
      expect(f.style).toBeDefined();
    }
  });

  it("has no duplicate filenames (deduplication check)", () => {
    const files = getKaTeXFontFiles();
    const filenames = files.map((f) => f.filename);
    const unique = new Set(filenames);
    expect(unique.size).toBe(filenames.length);
  });

  it("has no duplicate URLs", () => {
    const files = getKaTeXFontFiles();
    const urls = files.map((f) => f.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  it("all URLs point to CDN with woff2 format", () => {
    const files = getKaTeXFontFiles();
    for (const f of files) {
      expect(f.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net/);
      expect(f.url).toMatch(/\.woff2$/);
    }
  });

  it("all filenames end with .woff2", () => {
    const files = getKaTeXFontFiles();
    for (const f of files) {
      expect(f.filename).toMatch(/\.woff2$/);
    }
  });

  it("count matches KATEX_FONTS constant length", () => {
    const files = getKaTeXFontFiles();
    expect(files.length).toBe(KATEX_FONTS.length);
  });

  it("bold font has weight 'bold'", () => {
    const files = getKaTeXFontFiles();
    const bold = files.find((f) => f.filename.includes("Bold"));
    expect(bold).toBeDefined();
    expect(bold!.weight).toBe("bold");
  });

  it("italic fonts have style 'italic'", () => {
    const files = getKaTeXFontFiles();
    const italics = files.filter((f) => f.filename.includes("Italic"));
    expect(italics.length).toBeGreaterThan(0);
    for (const f of italics) {
      expect(f.style).toBe("italic");
    }
  });
});

// ---------------------------------------------------------------------------
// generateLocalFontCSS
// ---------------------------------------------------------------------------
describe("generateLocalFontCSS", () => {
  it("generates valid @font-face declarations", () => {
    const files: FontFile[] = [
      { family: "TestFont", filename: "test.woff2", url: "https://example.com/test.woff2", weight: "normal", style: "normal" },
    ];
    const css = generateLocalFontCSS(files);
    expect(css).toContain("@font-face");
    expect(css).toContain("TestFont");
    expect(css).toContain("format('woff2')");
  });

  it("uses custom base path", () => {
    const files: FontFile[] = [
      { family: "TestFont", filename: "test.woff2", url: "https://example.com/test.woff2", weight: "normal", style: "normal" },
    ];
    const css = generateLocalFontCSS(files, "custom/path");
    expect(css).toContain("custom/path/test.woff2");
  });

  it("defaults to assets/fonts base path", () => {
    const files: FontFile[] = [
      { family: "TestFont", filename: "test.woff2", url: "https://example.com/test.woff2", weight: "normal", style: "normal" },
    ];
    const css = generateLocalFontCSS(files);
    expect(css).toContain("assets/fonts/test.woff2");
  });

  it("produces no duplicate @font-face when given unique fonts", () => {
    const files = getKaTeXFontFiles();
    const css = generateLocalFontCSS(files);
    const matches = css.match(/@font-face/g) ?? [];
    expect(matches.length).toBe(files.length);
  });

  it("returns empty string for empty input", () => {
    const css = generateLocalFontCSS([]);
    expect(css).toBe("");
  });

  it("includes font-weight and font-style", () => {
    const files: FontFile[] = [
      { family: "BoldFont", filename: "bold.woff2", url: "https://x.com/b.woff2", weight: "bold", style: "italic" },
    ];
    const css = generateLocalFontCSS(files);
    expect(css).toContain("font-weight: bold");
    expect(css).toContain("font-style: italic");
  });

  it("separates multiple @font-face blocks with double newline", () => {
    const files: FontFile[] = [
      { family: "Font1", filename: "f1.woff2", url: "https://x.com/f1.woff2", weight: "normal", style: "normal" },
      { family: "Font2", filename: "f2.woff2", url: "https://x.com/f2.woff2", weight: "bold", style: "normal" },
    ];
    const css = generateLocalFontCSS(files);
    expect(css).toContain("}\n\n@font-face");
  });
});

// ---------------------------------------------------------------------------
// generateEmbeddedFontCSS
// ---------------------------------------------------------------------------
describe("generateEmbeddedFontCSS", () => {
  it("generates @font-face with data URI", () => {
    const fonts: EmbeddedFont[] = [
      {
        file: { family: "TestFont", filename: "test.woff2", url: "https://x.com/t.woff2", weight: "normal", style: "normal" },
        dataUri: "data:font/woff2;base64,AAAA",
      },
    ];
    const css = generateEmbeddedFontCSS(fonts);
    expect(css).toContain("@font-face");
    expect(css).toContain("data:font/woff2;base64,AAAA");
  });

  it("returns empty string for empty input", () => {
    expect(generateEmbeddedFontCSS([])).toBe("");
  });

  it("produces no duplicate @font-face for unique fonts", () => {
    const fonts: EmbeddedFont[] = [
      {
        file: { family: "Font1", filename: "f1.woff2", url: "https://x.com/f1.woff2", weight: "normal", style: "normal" },
        dataUri: "data:font/woff2;base64,AAAA",
      },
      {
        file: { family: "Font2", filename: "f2.woff2", url: "https://x.com/f2.woff2", weight: "bold", style: "normal" },
        dataUri: "data:font/woff2;base64,BBBB",
      },
    ];
    const css = generateEmbeddedFontCSS(fonts);
    const matches = css.match(/@font-face/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("preserves font-weight and font-style from file", () => {
    const fonts: EmbeddedFont[] = [
      {
        file: { family: "BoldItalic", filename: "bi.woff2", url: "https://x.com/bi.woff2", weight: "bold", style: "italic" },
        dataUri: "data:font/woff2;base64,CCCC",
      },
    ];
    const css = generateEmbeddedFontCSS(fonts);
    expect(css).toContain("font-weight: bold");
    expect(css).toContain("font-style: italic");
  });
});

// ---------------------------------------------------------------------------
// getKaTeXFontCSS
// ---------------------------------------------------------------------------
describe("getKaTeXFontCSS", () => {
  it("returns non-empty CSS string", () => {
    const css = getKaTeXFontCSS();
    expect(css.length).toBeGreaterThan(0);
  });

  it("contains @font-face for all KaTeX fonts", () => {
    const css = getKaTeXFontCSS();
    const matches = css.match(/@font-face/g) ?? [];
    expect(matches.length).toBe(KATEX_FONTS.length);
  });

  it("has no duplicate @font-face blocks (deduplication)", () => {
    const css = getKaTeXFontCSS();
    // Extract all URLs — they should all be unique
    const urlMatches = css.match(/url\('([^']+)'\)/g) ?? [];
    const uniqueUrls = new Set(urlMatches);
    expect(uniqueUrls.size).toBe(urlMatches.length);
  });

  it("references CDN URLs (not data URIs)", () => {
    const css = getKaTeXFontCSS();
    expect(css).toContain("cdn.jsdelivr.net");
    expect(css).not.toContain("data:font");
  });

  it("uses woff2 format for all fonts", () => {
    const css = getKaTeXFontCSS();
    const formatMatches = css.match(/format\('([^']+)'\)/g) ?? [];
    for (const match of formatMatches) {
      expect(match).toBe("format('woff2')");
    }
  });
});

// ---------------------------------------------------------------------------
// contentHasMath
// ---------------------------------------------------------------------------
describe("contentHasMath", () => {
  it("detects katex class", () => {
    expect(contentHasMath('<span class="katex">...</span>')).toBe(true);
  });

  it("detects math-inline class", () => {
    expect(contentHasMath('<span class="math-inline">x</span>')).toBe(true);
  });

  it("detects math-block class", () => {
    expect(contentHasMath('<div class="math-block">E=mc²</div>')).toBe(true);
  });

  it("returns false for plain HTML", () => {
    expect(contentHasMath("<p>Hello world</p>")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(contentHasMath("")).toBe(false);
  });

  it("is case-sensitive (katex not KATEX)", () => {
    expect(contentHasMath('<span class="KATEX">x</span>')).toBe(false);
  });

  it("detects katex anywhere in the string", () => {
    expect(contentHasMath("some text with katex in it")).toBe(true);
  });

  it("detects math-inline in nested HTML", () => {
    expect(contentHasMath('<div><p><span class="math-inline">E=mc²</span></p></div>')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getUserFontFile
// ---------------------------------------------------------------------------
describe("getUserFontFile", () => {
  it("returns FontFile for known settings key (jetbrains)", () => {
    const file = getUserFontFile("jetbrains");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("JetBrains Mono");
    expect(file!.url).toMatch(/\.woff2$/);
  });

  it("returns FontFile for known settings key (literata)", () => {
    const file = getUserFontFile("literata");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("Literata");
  });

  it("returns FontFile for firacode", () => {
    const file = getUserFontFile("firacode");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("Fira Code");
  });

  it("returns FontFile for ibmplexmono", () => {
    const file = getUserFontFile("ibmplexmono");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("IBM Plex Mono");
  });

  it("returns FontFile for CJK fonts (notoserif)", () => {
    const file = getUserFontFile("notoserif");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("Noto Serif CJK SC");
  });

  it("returns FontFile for CJK fonts (sourcehans)", () => {
    const file = getUserFontFile("sourcehans");
    expect(file).not.toBeNull();
    expect(file!.family).toBe("Source Han Sans SC");
  });

  it("returns null for unknown settings key", () => {
    expect(getUserFontFile("nonexistent-font")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getUserFontFile("")).toBeNull();
  });

  it("returned filename has no spaces (uses hyphens)", () => {
    const file = getUserFontFile("jetbrains");
    expect(file).not.toBeNull();
    expect(file!.filename).not.toContain(" ");
    expect(file!.filename).toContain("-");
  });

  it("returned filename ends with .woff2", () => {
    const file = getUserFontFile("literata");
    expect(file).not.toBeNull();
    expect(file!.filename).toMatch(/\.woff2$/);
  });

  it("all returned files have weight 'normal' and style 'normal'", () => {
    const keys = ["jetbrains", "literata", "firacode", "ibmplexmono", "notoserif", "sourcehans"];
    for (const key of keys) {
      const file = getUserFontFile(key);
      expect(file).not.toBeNull();
      expect(file!.weight).toBe("normal");
      expect(file!.style).toBe("normal");
    }
  });
});

// ---------------------------------------------------------------------------
// getGoogleFontUrl
// ---------------------------------------------------------------------------
describe("getGoogleFontUrl", () => {
  it("returns URL for known font family (Inter)", () => {
    const url = getGoogleFontUrl("Inter");
    expect(url).not.toBeNull();
    expect(url).toMatch(/^https:\/\/fonts\.gstatic\.com/);
  });

  it("returns URL for known font family (JetBrains Mono)", () => {
    const url = getGoogleFontUrl("JetBrains Mono");
    expect(url).not.toBeNull();
  });

  it("returns URL for CJK font (Noto Sans SC)", () => {
    const url = getGoogleFontUrl("Noto Sans SC");
    expect(url).not.toBeNull();
  });

  it("returns null for unknown font family", () => {
    expect(getGoogleFontUrl("Comic Sans MS")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getGoogleFontUrl("")).toBeNull();
  });

  it("is case-sensitive (inter vs Inter)", () => {
    expect(getGoogleFontUrl("inter")).toBeNull();
    expect(getGoogleFontUrl("Inter")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// downloadFont (requires fetch mock)
// ---------------------------------------------------------------------------
describe("downloadFont", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run downloadFont while advancing fake timers so backoff delays resolve. */
  async function runWithTimers(promise: Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    let result: Uint8Array | null = null;
    let done = false;
    promise.then((r) => { result = r; done = true; });
    while (!done) {
      await vi.advanceTimersByTimeAsync(5000);
    }
    return result;
  }

  it("returns Uint8Array on successful fetch", async () => {
    const fakeData = new Uint8Array([0x00, 0x01, 0x02]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
    } as Response);

    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(fakeData);
  });

  it("returns null on non-ok response after retries exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
    } as Response);

    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns null on network error after retries exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns null on fetch throwing TypeError after retries", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("retries on transient failure then succeeds", async () => {
    const fakeData = new Uint8Array([0x10, 0x20]);
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("DNS hiccup"))
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeData.buffer),
      } as Response);

    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toEqual(fakeData);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on non-ok response then succeeds", async () => {
    const fakeData = new Uint8Array([0x30]);
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeData.buffer),
      } as Response);

    const result = await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(result).toEqual(fakeData);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry on success", async () => {
    const fakeData = new Uint8Array([0x00]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeData.buffer),
    } as Response);

    await runWithTimers(downloadFont("https://example.com/font.woff2"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("respects custom retries parameter", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fail"));
    const result = await runWithTimers(downloadFont("https://example.com/font.woff2", 5));
    expect(result).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// fontDataToDataUri (already tested in uint8ArrayToBase64.test.ts, but
// adding deduplication-specific checks here)
// ---------------------------------------------------------------------------
describe("fontDataToDataUri", () => {
  it("produces valid data URI format", () => {
    const data = new Uint8Array([0x00, 0x01, 0x02]);
    const uri = fontDataToDataUri(data);
    expect(uri).toMatch(/^data:font\/woff2;base64,.+$/);
  });

  it("handles empty data", () => {
    const uri = fontDataToDataUri(new Uint8Array(0));
    expect(uri).toBe("data:font/woff2;base64,");
  });
});

// ---------------------------------------------------------------------------
// Integration: deduplication guarantee
// ---------------------------------------------------------------------------
describe("deduplication integration", () => {
  it("getKaTeXFontFiles returns same result on repeated calls", () => {
    const first = getKaTeXFontFiles();
    const second = getKaTeXFontFiles();
    expect(first).toEqual(second);
    expect(first.length).toBe(second.length);
  });

  it("getKaTeXFontCSS returns same result on repeated calls (no accumulation)", () => {
    const first = getKaTeXFontCSS();
    const second = getKaTeXFontCSS();
    expect(first).toBe(second);
  });

  it("generating CSS from font files produces exactly one @font-face per file", () => {
    const files = getKaTeXFontFiles();
    const css = generateLocalFontCSS(files);
    const fontFaceCount = (css.match(/@font-face/g) ?? []).length;
    expect(fontFaceCount).toBe(files.length);
  });

  it("no font filename appears more than once in generated CSS", () => {
    const files = getKaTeXFontFiles();
    const css = generateLocalFontCSS(files);
    for (const file of files) {
      const regex = new RegExp(file.filename, "g");
      const matches = css.match(regex) ?? [];
      expect(matches.length).toBe(1);
    }
  });
});
