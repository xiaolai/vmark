/**
 * KaTeX Font Embedding
 *
 * Inlines KaTeX woff2 fonts as base64 data URIs so exported PDF HTML needs
 * no network access and renders identically offline or behind a blocker.
 *
 * Only woff2 is embedded (all modern WebKits support it); woff/ttf fallbacks
 * in the original CSS are stripped to keep the HTML size bounded at roughly
 * 400 KB of base64 math fonts.
 *
 * @module export/katexFontEmbed
 */

import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?inline";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?inline";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?inline";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?inline";
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline";
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline";
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline";
import scriptRegular from "katex/dist/fonts/KaTeX_Script-Regular.woff2?inline";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline";
import size3Regular from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline";
import size4Regular from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline";

const FONT_MAP: Record<string, string> = {
  "KaTeX_AMS-Regular.woff2": amsRegular,
  "KaTeX_Caligraphic-Bold.woff2": caligraphicBold,
  "KaTeX_Caligraphic-Regular.woff2": caligraphicRegular,
  "KaTeX_Fraktur-Bold.woff2": frakturBold,
  "KaTeX_Fraktur-Regular.woff2": frakturRegular,
  "KaTeX_Main-Bold.woff2": mainBold,
  "KaTeX_Main-BoldItalic.woff2": mainBoldItalic,
  "KaTeX_Main-Italic.woff2": mainItalic,
  "KaTeX_Main-Regular.woff2": mainRegular,
  "KaTeX_Math-BoldItalic.woff2": mathBoldItalic,
  "KaTeX_Math-Italic.woff2": mathItalic,
  "KaTeX_SansSerif-Bold.woff2": sansSerifBold,
  "KaTeX_SansSerif-Italic.woff2": sansSerifItalic,
  "KaTeX_SansSerif-Regular.woff2": sansSerifRegular,
  "KaTeX_Script-Regular.woff2": scriptRegular,
  "KaTeX_Size1-Regular.woff2": size1Regular,
  "KaTeX_Size2-Regular.woff2": size2Regular,
  "KaTeX_Size3-Regular.woff2": size3Regular,
  "KaTeX_Size4-Regular.woff2": size4Regular,
  "KaTeX_Typewriter-Regular.woff2": typewriterRegular,
};

/**
 * Rewrite KaTeX CSS so every @font-face uses an inlined base64 woff2 data URI
 * and strips the woff/ttf fallbacks. If a font filename isn't in the embed
 * map, the original relative URL is left untouched as a last-resort fallback.
 */
export function embedKatexFonts(rawCss: string): string {
  return rawCss.replace(
    /src:\s*url\(fonts\/([^)]+\.woff2)\)\s*format\("woff2"\)(?:,\s*url\([^)]+\)\s*format\("[^"]+"\))*/g,
    (_match, filename: string) => {
      const uri = FONT_MAP[filename];
      return uri
        ? `src:url(${uri}) format("woff2")`
        : `src:url(fonts/${filename}) format("woff2")`;
    },
  );
}

/** Exported for tests — lists every woff2 font the embed module ships. */
export const EMBEDDED_FONT_FILENAMES = Object.keys(FONT_MAP);
