/**
 * Font Stacks
 *
 * Purpose: Pure font-family stack definitions and resolution for the editor's
 *   `--font-sans` / `--font-mono` design tokens. No DOM access, no store
 *   imports — leaf-pure per ADR-013 (`src/utils/`).
 *
 * Key decisions:
 *   - Latin and CJK families each carry a system fallback; the mono table holds
 *     NAMED families only and the platform tail supplies the fallback, because
 *     which generic is safe depends on the OS (see `MONO_TAIL`).
 *   - The sans stack is `<latin>, <cjk>`; the Latin stack's trailing generic
 *     family is stripped first so CJK glyph resolution actually reaches the CJK
 *     fonts (issue #1056).
 *   - Mono resolution takes the platform as a PARAMETER. The module stays
 *     leaf-pure (ADR-013) — the `navigator` read happens at the call site.
 *   - What this module returns is the PREFERRED stack. It is not verified, and
 *     on WebKitGTK the engine does not always render it — callers that need a
 *     real character grid go through `services/fonts/verifiedMonoStack`.
 *
 * @coordinates-with hooks/useTheme.ts — consumes these to emit CSS vars
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — live mono sync
 * @module utils/fontStacks
 */
import type { RuntimePlatform } from "./platform";

export const fontStacks = {
  latin: {
    system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    athelas: "Athelas, Georgia, serif", // Apple Books default
    palatino: "Palatino, 'Palatino Linotype', serif",
    georgia: "Georgia, 'Times New Roman', serif",
    charter: "Charter, Georgia, serif",
    literata: "Literata, Georgia, serif", // Google reading font
  },
  cjk: {
    system: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    pingfang: '"PingFang SC", "PingFang TC", sans-serif', // Apple Books
    songti: '"Songti SC", "STSong", "SimSun", serif',
    kaiti: '"Kaiti SC", "STKaiti", "KaiTi", serif',
    notoserif: '"Noto Serif CJK SC", "Source Han Serif SC", serif',
    sourcehans: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
  },
  /**
   * Monospace families — NAMED ONLY. The generic comes from `MONO_TAIL`, which
   * picks the one that means something on the running platform.
   *
   * A name here is a PREFERENCE, not a promise: nothing guarantees the user has
   * the font, and on WebKitGTK an absent family can still capture the cascade
   * (#1334). `services/fonts/verifiedMonoStack` is what makes the result safe.
   */
  mono: {
    /** No named family — take the platform's own monospace default. */
    system: "",
    // macOS system fonts. "SF Mono" does not resolve by family name in WebKit
    // (its real family is the hidden ".SF NS Mono"), so on macOS this entry is
    // satisfied by `ui-monospace` in the tail — which is the point of the tail.
    sfmono: '"SF Mono"',
    monaco: "Monaco",
    menlo: "Menlo",
    // Windows
    consolas: 'Consolas, "Courier New"',
    // Linux distribution defaults (#1334)
    dejavu: '"DejaVu Sans Mono"',
    liberation: '"Liberation Mono"',
    ubuntumono: '"Ubuntu Mono"',
    notosansmono: '"Noto Sans Mono"',
    notosansmonocjk: '"Noto Sans Mono CJK SC"',
    // Popular coding fonts (Nerd Font versions for terminal icon support)
    jetbrains: '"JetBrains Mono"',
    firacode: '"Fira Code"',
    saucecodepro: '"SauceCodePro Nerd Font Mono", "SauceCodePro NFM"',
    ibmplexmono: '"IBM Plex Mono"',
    hack: "Hack",
    inconsolata: "Inconsolata",
  },
};

/**
 * The fallback appended to every monospace stack, per platform.
 *
 * This is hygiene, NOT the fix for #1334 — that lives in
 * `services/fonts/verifiedMonoStack`, which measures what the engine actually
 * renders. Two explanations were tried here first and both were refuted by
 * measurement on Ubuntu 24.04.4 / WebKitGTK 4.1; the note is kept because the
 * refutations are the useful part:
 *
 *   - "`ui-monospace` is unimplemented on GTK, and a generic always matches, so
 *     it wins the cascade." Half right. It IS unimplemented — WebKit's own GTK
 *     expectations say so (`webkit.org/b/304535`) and alone it yields a
 *     proportional font. But in a LIST it is skipped like an absent family:
 *     `ui-monospace, monospace` measures 8/8 under `LANG=C`.
 *   - "It only bites when the GTK UI font is a real installed family." Also
 *     refuted: setting `gtk-font-name=DejaVu Sans 11` (confirmed read back from
 *     `Gtk.Settings`) changed nothing.
 *
 * What actually triggers it is the LOCALE. Under `LANG=zh_CN.UTF-8` with
 * `fonts-noto-cjk` installed, `"No Such Family XYZ", monospace` measures 11/4 —
 * proportional — because fontconfig returns a best match for ANY family name
 * instead of reporting no match, and WebKit accepts it, so the cascade never
 * reaches the generic. `ui-monospace` is not special; any unmatched head family
 * does it.
 *
 * So the tail is only worth keeping for what it plainly is: `ui-monospace` is
 * the ONLY way to reach SF Mono in WebKit on macOS (measured — `"SF Mono"` and
 * `SFMono-Regular` both fail to match by name, the real family being the hidden
 * `.SF NS Mono`), and it means nothing on Linux, so it is not emitted there.
 * Reordering alone never fixed the bug and must not be relied on to.
 */
const MONO_TAIL: Record<RuntimePlatform, string> = {
  // ui-monospace → SF Mono. Falls through to the generic (Menlo) if it ever
  // stops resolving, which is what the old explicit chain resolved to anyway.
  macos: "ui-monospace, monospace",
  // WebView2 is Chromium; ui-monospace maps to the fixed-font preference.
  windows: "ui-monospace, monospace",
  // WebKitGTK: ui-monospace is unimplemented here, so emitting it is noise.
  // The generic honours the desktop's own monospace choice, which is what the
  // native terminal uses — but it is NOT a guarantee on its own; see
  // services/fonts/verifiedMonoStack.
  linux: "monospace",
};

/**
 * Resolve the monospace font stack for a given `monoFont` setting key. Pure —
 * no DOM access; pass `getRuntimePlatform()` from the call site. This is the
 * same mapping `buildFontStack` applies to the editor's `--font-mono`, exposed
 * on its own so the live terminal-font sync can read the new font straight from
 * the setting instead of round-tripping through the CSS var (which `useTheme`
 * only writes in a later effect).
 *
 * An unknown key resolves to the platform tail alone, i.e. exactly what the
 * `system` key gives — the pre-#1334 behaviour, which fell back to `system`.
 */
export function resolveMonoFontStack(
  monoFont: string,
  platform: RuntimePlatform,
): string {
  const named =
    fontStacks.mono[monoFont as keyof typeof fontStacks.mono] ??
    fontStacks.mono.system;
  const tail = MONO_TAIL[platform];
  return named ? `${named}, ${tail}` : tail;
}

/**
 * CSS generic font families. When one of these terminates a stack, the browser
 * stops glyph resolution there — it never falls through to a later named font.
 */
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "cursive",
  "fantasy",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/**
 * Drop trailing generic families from a font stack.
 *
 * Issue #1056: the sans stack is `<latin>, <cjk>`. The Latin sub-stacks all end
 * in a generic family (e.g. `Athelas, Georgia, serif`). Because that generic
 * sits *before* the CJK fonts, the browser resolves CJK glyphs against the
 * system serif/sans-serif and never reaches the CJK stack — so the CJK Font
 * setting has no effect, and the Latin Font setting bleeds its serif/sans-serif
 * category onto CJK text. Stripping the Latin stack's trailing generic lets the
 * CJK fonts (and the CJK stack's own trailing generic, kept as the final
 * fallback) take effect. Always keeps at least one named family.
 */
function stripTrailingGenerics(stack: string): string {
  const parts = stack.split(",").map((p) => p.trim());
  while (
    parts.length > 1 &&
    GENERIC_FONT_FAMILIES.has(parts[parts.length - 1].toLowerCase())
  ) {
    parts.pop();
  }
  return parts.join(", ");
}

/**
 * Build font stacks from font key selections. Pure — no DOM access; pass
 * `getRuntimePlatform()` from the call site.
 *
 * `platform` is required rather than defaulted: defaulting to "macos" is what
 * `getRuntimePlatform`'s own doc warns against, and here it would hand a Linux
 * user the `ui-monospace` stack this function exists to keep away from them.
 */
export function buildFontStack(
  latinFont: string,
  cjkFont: string,
  monoFont: string,
  platform: RuntimePlatform
): { sans: string; mono: string } {
  const latinStack =
    fontStacks.latin[latinFont as keyof typeof fontStacks.latin] ||
    fontStacks.latin.system;
  const cjkStack =
    fontStacks.cjk[cjkFont as keyof typeof fontStacks.cjk] ||
    fontStacks.cjk.system;

  // Strip the Latin stack's trailing generic so CJK glyph resolution reaches
  // the CJK stack (#1056). The CJK stack keeps its own trailing generic, which
  // becomes the overall fallback.
  return {
    sans: `${stripTrailingGenerics(latinStack)}, ${cjkStack}`,
    mono: resolveMonoFontStack(monoFont, platform),
  };
}
