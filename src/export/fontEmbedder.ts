/**
 * Font Embedder
 *
 * Embeds user-configured fonts into exported HTML.
 * Ensures consistent typography across different machines.
 */

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
const KATEX_CDN_BASE = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts";

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
 */
export async function downloadFont(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.warn("[FontEmbedder] Failed to download font:", url, error);
    return null;
  }
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
  // Use jsDelivr CDN for KaTeX fonts
  const cdnBase = "https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts";

  return `
/* KaTeX Fonts */
@font-face {
  font-family: 'KaTeX_Main';
  src: url('${cdnBase}/KaTeX_Main-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
@font-face {
  font-family: 'KaTeX_Main';
  src: url('${cdnBase}/KaTeX_Main-Bold.woff2') format('woff2');
  font-weight: bold;
  font-style: normal;
}
@font-face {
  font-family: 'KaTeX_Main';
  src: url('${cdnBase}/KaTeX_Main-Italic.woff2') format('woff2');
  font-weight: normal;
  font-style: italic;
}
@font-face {
  font-family: 'KaTeX_Math';
  src: url('${cdnBase}/KaTeX_Math-Italic.woff2') format('woff2');
  font-weight: normal;
  font-style: italic;
}
@font-face {
  font-family: 'KaTeX_Size1';
  src: url('${cdnBase}/KaTeX_Size1-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
@font-face {
  font-family: 'KaTeX_Size2';
  src: url('${cdnBase}/KaTeX_Size2-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
@font-face {
  font-family: 'KaTeX_Size3';
  src: url('${cdnBase}/KaTeX_Size3-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
@font-face {
  font-family: 'KaTeX_Size4';
  src: url('${cdnBase}/KaTeX_Size4-Regular.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
`.trim();
}

/**
 * Fetch a font file and convert to base64 data URI.
 */
async function fetchFontAsDataUri(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const base64 = uint8ArrayToBase64(bytes);

    // Determine format from URL
    const format = url.includes(".woff2")
      ? "woff2"
      : url.includes(".woff")
        ? "woff"
        : url.includes(".ttf")
          ? "truetype"
          : url.includes(".otf")
            ? "opentype"
            : "woff2";

    const mimeType =
      format === "woff2"
        ? "font/woff2"
        : format === "woff"
          ? "font/woff"
          : format === "truetype"
            ? "font/ttf"
            : "font/otf";

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn("[FontEmbedder] Failed to fetch font:", url, error);
    return null;
  }
}

/**
 * Generate @font-face CSS for a font configuration.
 */
function generateFontFace(config: FontConfig, dataUri?: string): string {
  const src = dataUri ?? config.src;
  const format = config.format ?? "woff2";
  const srcValue = dataUri
    ? `url('${src}') format('${format}')`
    : `url('${src}') format('${format}')`;

  return `
@font-face {
  font-family: '${config.family}';
  src: ${srcValue};
  font-weight: ${config.weight ?? "normal"};
  font-style: ${config.style ?? "normal"};
}`.trim();
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
  if (!url) return null;

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
 * Embed fonts for export.
 *
 * @param fonts - Array of font configurations to embed
 * @param embedAsDataUri - If true, fonts are embedded as data URIs; otherwise, URLs are used
 * @returns Result containing CSS and status
 *
 * @example
 * ```ts
 * const result = await embedFonts([
 *   { family: 'Inter', src: 'https://...' }
 * ], true);
 *
 * // result.css contains @font-face declarations
 * ```
 */
export async function embedFonts(
  fonts: FontConfig[],
  embedAsDataUri: boolean = false
): Promise<FontEmbedResult> {
  const embedded: string[] = [];
  const failed: string[] = [];
  const fontFaces: string[] = [];
  let totalSize = 0;

  for (const font of fonts) {
    try {
      if (embedAsDataUri) {
        const dataUri = await fetchFontAsDataUri(font.src);
        if (dataUri) {
          fontFaces.push(generateFontFace(font, dataUri));
          embedded.push(font.family);
          // Estimate size from base64 (roughly 4/3 of original)
          totalSize += Math.round((dataUri.length * 3) / 4);
        } else {
          // Fallback to URL
          fontFaces.push(generateFontFace(font));
          failed.push(font.family);
        }
      } else {
        fontFaces.push(generateFontFace(font));
        embedded.push(font.family);
      }
    } catch {
      failed.push(font.family);
    }
  }

  return {
    css: fontFaces.join("\n\n"),
    embedded,
    failed,
    totalSize,
  };
}

/**
 * Get fonts to embed based on user settings.
 *
 * Reads the user's font configuration and prepares fonts for embedding.
 *
 * @param settings - User's font settings from Settings store
 * @returns Array of font configurations
 */
export function getFontsFromSettings(settings: {
  fontFamily?: string;
  monoFontFamily?: string;
}): FontConfig[] {
  const fonts: FontConfig[] = [];

  // Check body font
  if (settings.fontFamily) {
    const url = getGoogleFontUrl(settings.fontFamily);
    if (url) {
      fonts.push({
        family: settings.fontFamily,
        src: url,
        format: "woff2",
      });
    }
  }

  // Check mono font
  if (settings.monoFontFamily) {
    const url = getGoogleFontUrl(settings.monoFontFamily);
    if (url) {
      fonts.push({
        family: settings.monoFontFamily,
        src: url,
        format: "woff2",
      });
    }
  }

  return fonts;
}

/**
 * Check if content contains math (KaTeX) that requires font embedding.
 */
export function contentHasMath(html: string): boolean {
  return html.includes("katex") || html.includes("math-inline") || html.includes("math-block");
}

/**
 * Generate complete font CSS for export.
 *
 * Includes:
 * - User-configured fonts
 * - KaTeX fonts (if math is present)
 */
export async function generateExportFontCSS(
  html: string,
  settings: { fontFamily?: string; monoFontFamily?: string },
  embedAsDataUri: boolean = false
): Promise<{ css: string; totalSize: number }> {
  const cssParts: string[] = [];
  let totalSize = 0;

  // Add KaTeX fonts if math is present
  if (contentHasMath(html)) {
    cssParts.push(getKaTeXFontCSS());
  }

  // Add user fonts
  const userFonts = getFontsFromSettings(settings);
  if (userFonts.length > 0) {
    const result = await embedFonts(userFonts, embedAsDataUri);
    if (result.css) {
      cssParts.push(result.css);
      totalSize += result.totalSize;
    }
  }

  return {
    css: cssParts.join("\n\n"),
    totalSize,
  };
}
