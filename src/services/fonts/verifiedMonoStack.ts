/**
 * verifiedMonoStack
 *
 * Purpose: Return a monospace font stack that has been MEASURED to render
 *   monospace in this engine, downgrading through the stack until one does.
 *
 * Why this exists, and why it measures instead of reasoning (#1334):
 *
 *   The CSS cascade is supposed to skip a family that is not installed. On
 *   WebKitGTK under a CJK locale it does not. Measured on Ubuntu 24.04.4 with
 *   `fonts-noto-cjk` and `LANG=zh_CN.UTF-8`, using the same `'W' x 32` vs
 *   `'i' x 32` comparison xterm.js's CharSizeService uses:
 *
 *     stack                                LANG=C    LANG=zh_CN.UTF-8
 *     `"No Such Family XYZ", monospace`    8 / 8     11 / 4  <- proportional
 *     `"JetBrains Mono", monospace`        8 / 8     11 / 4  <- proportional
 *     `monospace`                          8 / 8      7 / 7
 *
 *   fontconfig returns a best match for ANY family name rather than reporting
 *   no match, and under a CJK locale that best match is a proportional CJK
 *   face. WebKit accepts it, so the cascade STOPS at the unmatched head family
 *   and never reaches the generic behind it.
 *
 *   The consequence is a terminal bug, not merely an ugly one: xterm.js sizes
 *   its character cell from the advance of `W`, so a proportional font makes
 *   every cell as wide as a `W` while narrow glyphs keep their own advance —
 *   the whole grid renders spaced out, for Latin and CJK alike, under every
 *   renderer. The editor's code blocks and Source mode read the same
 *   `--font-mono` and are wrong with it.
 *
 * Key decisions:
 *   - **Assert the property, do not model the cause.** Two earlier attempts at
 *     this bug named a mechanism (`ui-monospace` is unimplemented on GTK; the
 *     GTK UI font shadows the stack) and both were refuted by measurement. What
 *     survives every explanation is the property the terminal actually needs:
 *     the stack must render with a uniform advance. So that is what is checked.
 *   - **Drop the head, then re-measure.** This performs the cascade step the
 *     engine skipped, so a stack keeps the user's font when it is installed and
 *     degrades one family at a time when it is not.
 *   - Results are memoized per stack string. VMark ships no web fonts, so the
 *     set of installed families does not change within a session.
 *   - Without a DOM (node tests, SSR) the preferred stack is returned
 *     unmeasured. There is nothing to measure and guessing would be worse.
 *
 * @coordinates-with utils/fontStacks.ts — supplies the preferred stack
 * @coordinates-with hooks/useTheme.ts — writes the verified stack to --font-mono
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — live terminal font
 * @module services/fonts/verifiedMonoStack
 */
import { resolveMonoFontStack } from "@/utils/fontStacks";
import type { RuntimePlatform } from "@/utils/platform";

/**
 * Glyph count per sample. Matches xterm.js's `DomMeasureStrategyConstants`, so
 * this measures the same quantity the terminal will later derive its cell from.
 */
const REPEAT = 32;

/**
 * Probe size in px. Deliberately larger than any UI font size: `offsetWidth` is
 * an integer, and at small sizes the rounding gap between a wide and a narrow
 * glyph can close enough to make a proportional font look uniform.
 */
const PROBE_PX = 32;

/** Mean advance of `char` under `stack`, or null when there is no DOM. */
function advance(stack: string, char: string): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;font-kerning:none;";
  span.style.fontSize = `${PROBE_PX}px`;
  span.style.fontFamily = stack;
  span.textContent = char.repeat(REPEAT);
  document.body.appendChild(span);
  const width = span.offsetWidth;
  span.remove();
  return width / REPEAT;
}

/**
 * True when `stack` renders with a uniform advance — i.e. really monospace.
 *
 * Returns true when the engine cannot be measured, so a DOM-less caller keeps
 * whatever it asked for rather than being silently downgraded.
 */
export function stackRendersMonospace(stack: string): boolean {
  const wide = advance(stack, "W");
  const narrow = advance(stack, "i");
  if (wide === null || narrow === null) return true;
  // A zero-width measurement means the span never laid out (detached document,
  // display:none ancestor). That is "cannot measure", not "not monospace".
  if (wide === 0 && narrow === 0) return true;
  return wide === narrow;
}

const memo = new Map<string, string>();

/**
 * Drop leading families until the remainder renders monospace.
 *
 * Exported for tests, which inject `rendersMonospace` so the algorithm can be
 * driven deterministically without depending on which fonts a machine happens
 * to have installed — the exact dependency that let the previous version of
 * this guard pass everywhere while the bug was live.
 */
export function narrowToMonospace(
  stack: string,
  rendersMonospace: (candidate: string) => boolean = stackRendersMonospace,
): string {
  const families = stack
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  if (!families.length) return stack;

  for (let i = 0; i < families.length; i++) {
    const candidate = families.slice(i).join(", ");
    if (rendersMonospace(candidate)) return candidate;
  }
  // Nothing in the stack measured monospace, the bare generic included. Return
  // the generic anyway: it is the engine's own idea of a fixed-pitch font and
  // there is no better answer left.
  return families[families.length - 1];
}

/**
 * The monospace stack for a setting, verified against this engine.
 *
 * Prefer this over `resolveMonoFontStack` at any site that hands a font to
 * something which assumes a character grid.
 */
export function verifiedMonoStack(
  monoFont: string,
  platform: RuntimePlatform,
): string {
  const preferred = resolveMonoFontStack(monoFont, platform);
  const cached = memo.get(preferred);
  if (cached !== undefined) return cached;
  const verified = narrowToMonospace(preferred);
  memo.set(preferred, verified);
  return verified;
}

/** Clear the measurement cache. For tests. */
export function resetMonoStackCache(): void {
  memo.clear();
}
