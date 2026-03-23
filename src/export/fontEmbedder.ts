/**
 * Font Embedder
 *
 * Embeds user-configured fonts into exported HTML.
 * Ensures consistent typography across different machines.
 */

import { exportWarn } from "@/utils/debug";

/** Configuration for a font to embed in exported HTML. */
export interface FontConfig {
  /** Font family name */
  family: string;
  /** Font source URL or path */
  src: string;
  /** Font weight (default: 'normal') */
  weight?: string;
  /** Font style (default: 'normal') */
  style?: string;
  /** Font format (woff2, woff, truetype, etc.) */
  format?: string;
}

/** Result of font embedding including generated CSS, successes, and failures. */
export interface FontEmbedResult {
  /** CSS @font-face declarations */
  css: string;
  /** Fonts that were successfully embedded */
  embedded: string[];
  /** Fonts that failed to embed */
  failed: string[];
  /** Total size of embedded fonts in bytes */
  totalSize: number;
}

/**
 * KaTeX fonts that must always be embedded for math rendering.
 * These are bundled with the application.
 */
export const KATEX_FONTS = [
  "KaTeX_Main-Regular",
  "KaTeX_Main-Bold",
  "KaTeX_Main-Italic",
  "KaTeX_Math-Italic",
  "KaTeX_Size1-Regular",
  "KaTeX_Size2-Regular",
  "KaTeX_Size3-Regular",
  "KaTeX_Size4-Regular",
] as const;

/** KaTeX CDN base URL */
const KATEX_CDN_BASE = "https://cdn.jsdelivr.net/npm/katex@0.16.28/dist/fonts";

/** Font file to download */
export interface FontFile {
  /** Font family name */
  family: string;
  /** Local filename (e.g., "KaTeX_Main-Regular.woff2") */
  filename: string;
  /** Source URL to download from */
  url: string;
  /** Font weight */
  weight: string;
  /** Font style */
  style: string;
}

/** Downloaded font data */
export interface DownloadedFont {
  /** Font file info */
  file: FontFile;
  /** Binary font data */
  data: Uint8Array;
}

/**
 * Get list of KaTeX font files to download.
 */
export function getKaTeXFontFiles(): FontFile[] {
  return [
    { family: "KaTeX_Main", filename: "KaTeX_Main-Regular.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Main-Regular.woff2`, weight: "normal", style: "normal" },
    { family: "KaTeX_Main", filename: "KaTeX_Main-Bold.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Main-Bold.woff2`, weight: "bold", style: "normal" },
    { family: "KaTeX_Main", filename: "KaTeX_Main-Italic.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Main-Italic.woff2`, weight: "normal", style: "italic" },
    { family: "KaTeX_Math", filename: "KaTeX_Math-Italic.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Math-Italic.woff2`, weight: "normal", style: "italic" },
    { family: "KaTeX_Size1", filename: "KaTeX_Size1-Regular.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Size1-Regular.woff2`, weight: "normal", style: "normal" },
    { family: "KaTeX_Size2", filename: "KaTeX_Size2-Regular.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Size2-Regular.woff2`, weight: "normal", style: "normal" },
    { family: "KaTeX_Size3", filename: "KaTeX_Size3-Regular.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Size3-Regular.woff2`, weight: "normal", style: "normal" },
    { family: "KaTeX_Size4", filename: "KaTeX_Size4-Regular.woff2", url: `${KATEX_CDN_BASE}/KaTeX_Size4-Regular.woff2`, weight: "normal", style: "normal" },
  ];
}

/**
 * Download a font file and return the binary data.
 * Retries with exponential backoff on transient failures (network errors, non-ok responses).
 */
export async function downloadFont(url: string, retries = 3): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          if (attempt === retries - 1) return null;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      if (attempt === retries - 1) {
        exportWarn("Failed to download font after retries:", url, error);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  /* v8 ignore next */
  return null;
}

/**
 * Generate @font-face CSS pointing to local font files.
 *
 * @param fonts - Array of font file info
 * @param basePath - Base path for font URLs (e.g., "assets/fonts")
 */
export function generateLocalFontCSS(fonts: FontFile[], basePath: string = "assets/fonts"): string {
  return fonts.map(font => `@font-face {
  font-family: '${font.family}';
  src: url('${basePath}/${font.filename}') format('woff2');
  font-weight: ${font.weight};
  font-style: ${font.style};
}`).join("\n\n");
}

/** Font with embedded data */
export interface EmbeddedFont {
  file: FontFile;
  dataUri: string;
}

/**
 * Generate @font-face CSS with embedded data URIs.
 * For standalone HTML that needs no external dependencies.
 */
export function generateEmbeddedFontCSS(fonts: EmbeddedFont[]): string {
  return fonts.map(({ file, dataUri }) => `@font-face {
  font-family: '${file.family}';
  src: url('${dataUri}') format('woff2');
  font-weight: ${file.weight};
  font-style: ${file.style};
}`).join("\n\n");
}

/**
 * Convert Uint8Array to base64 without hitting V8's argument-count limit.
 * String.fromCharCode(...data) crashes for arrays > ~65 KB because the
 * spread exceeds the maximum number of function arguments.
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Convert font binary data to base64 data URI.
 */
export function fontDataToDataUri(data: Uint8Array): string {
  const base64 = uint8ArrayToBase64(data);
  return `data:font/woff2;base64,${base64}`;
}

/**
 * Get the KaTeX font CSS.
 * KaTeX fonts are loaded from CDN in exports since they're not bundled.
 */
export function getKaTeXFontCSS(): string {
  return generateLocalFontCSS(getKaTeXFontFiles(), KATEX_CDN_BASE);
}

/**
 * Common web fonts that can be loaded from Google Fonts.
 */
const GOOGLE_FONTS: Record<string, string> = {
  Inter: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff2",
  Literata: "https://fonts.gstatic.com/s/literata/v35/or3PQ6P12-iJxAIgLa78DkrbXsDgk0oVDaDPYLanFLHpPf2TbBG_F_bcTWCWp8g.woff2",
  "Fira Code": "https://fonts.gstatic.com/s/firacode/v22/uU9NCBsR6Z2vfE9aq3bL0fxyUs4tcw4W_D1sFVc.woff2",
  "JetBrains Mono": "https://fonts.gstatic.com/s/jetbrainsmono/v18/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjOVGaysH0.woff2",
  "Source Code Pro": "https://fonts.gstatic.com/s/sourcecodepro/v23/HI_diYsKILxRpg3hIP6sJ7fM7PqPMcMnZFqUwX28DMyQtMdrTGasEmUl.woff2",
  "IBM Plex Sans": "https://fonts.gstatic.com/s/ibmplexsans/v19/zYXgKVElMYYaJe8bpLHnCwDKhdHeFaxOedc.woff2",
  "IBM Plex Mono": "https://fonts.gstatic.com/s/ibmplexmono/v19/-F63fjptAgt5VM-kVkqdyU8n5igg1l9kn-s.woff2",
  Roboto: "https://fonts.gstatic.com/s/roboto/v32/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2",
  "Roboto Mono": "https://fonts.gstatic.com/s/robotomono/v23/L0xuDF4xlVMF-BfR8bXMIhJHg45mwgGEFl0_3vq_ROW4.woff2",
  "Noto Sans": "https://fonts.gstatic.com/s/notosans/v35/o-0IIpQlx3QUlC5A4PNb4j5Ba_2c7A.woff2",
  "Noto Sans SC": "https://fonts.gstatic.com/s/notosanssc/v36/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzS5HE.woff2",
  "Noto Serif CJK SC": "https://fonts.gstatic.com/s/notoserifsc/v22/H4c8BXePl9DZ0Xe7gG9cyOj7oqPcbj6IJdGTyO2SvLeF0EU.woff2",
  "Source Han Sans SC": "https://fonts.gstatic.com/s/notosanssc/v36/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzS5HE.woff2",
};

/**
 * Map from settings keys to Google Font family names.
 * Only fonts that are available as web fonts are included.
 */
const SETTINGS_TO_FONT_FAMILY: Record<string, string> = {
  // Latin fonts
  literata: "Literata",
  // Mono fonts
  jetbrains: "JetBrains Mono",
  firacode: "Fira Code",
  ibmplexmono: "IBM Plex Mono",
  // CJK fonts
  notoserif: "Noto Serif CJK SC",
  sourcehans: "Source Han Sans SC",
};

/**
 * Get FontFile for a user-selected font (if it's a web font).
 */
export function getUserFontFile(settingsKey: string): FontFile | null {
  const family = SETTINGS_TO_FONT_FAMILY[settingsKey];
  if (!family) return null;

  const url = GOOGLE_FONTS[family];
  /* v8 ignore start -- all entries in SETTINGS_TO_FONT_FAMILY map to a known GOOGLE_FONTS key */
  if (!url) return null;
  /* v8 ignore stop */

  const filename = `${family.replace(/\s+/g, "-")}.woff2`;
  return {
    family,
    filename,
    url,
    weight: "normal",
    style: "normal",
  };
}

/**
 * Try to get a Google Fonts URL for a font family.
 */
export function getGoogleFontUrl(family: string): string | null {
  return GOOGLE_FONTS[family] ?? null;
}

/**
 * Check if content contains math (KaTeX) that requires font embedding.
 */
export function contentHasMath(html: string): boolean {
  return html.includes("katex") || html.includes("math-inline") || html.includes("math-block");
}

