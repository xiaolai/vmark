/**
 * Workspace rail identity glyphs.
 *
 * Split from workspaceIdentity.ts to keep that file under the 300-line gate
 * (rule 00: ratchet down, never raise a baseline). Self-contained and pure —
 * no store or React imports — so the edge cases (CJK, emoji, dotfiles,
 * colliding initials) are unit-tested directly.
 */


/** Longest glyph we will render — a 30px rail cannot show more legibly. */
const MAX_GLYPH_LENGTH = 3;
/** Shown when a name yields no letter or digit at all (e.g. "", "...", "   "). */
const FALLBACK_GLYPH = "?";

/**
 * Code points of `name` from the first alphanumeric onward, uppercased.
 *
 * `Array.from` (not `name[0]`) so an emoji or any astral character is taken as
 * one code point instead of a lone surrogate that renders as U+FFFD.
 *
 * Skips leading PUNCTUATION and SEPARATORS only, so a dotfile-style root
 * (`.config`) yields "C" rather than ".". It deliberately does not require a
 * letter or digit: an emoji is a perfectly good identity glyph for a folder
 * named "🚀 project", and skipping past it to "P" would discard the most
 * recognisable character in the name.
 */
function glyphSource(name: string): string[] {
  const chars = Array.from(name.trim().toUpperCase());
  const start = chars.findIndex((c) => !/[\p{P}\p{Z}\p{C}]/u.test(c));
  return start === -1 ? [] : chars.slice(start);
}

/**
 * Per-instance rail glyphs, derived from the workspace NAME.
 *
 * The rail previously showed `index + 1`, a POSITIONAL number: it changed on
 * reorder, so it identified nothing stable, while the name — the only real
 * identifier — was hidden in a `title` tooltip. These glyphs put identity in
 * the same 30px (the Slack / VS Code-profile pattern).
 *
 * Each glyph is the SHORTEST UNIQUE prefix among the workspaces shown, so
 * `alpha` and `apex` become "AL"/"AP" instead of two identical "A"s, capped at
 * MAX_GLYPH_LENGTH. Names that still collide at the cap keep the same glyph —
 * the accent colour and the accessible name continue to distinguish them, and
 * an over-long glyph would not fit the rail.
 *
 * Loose instances get NO glyph: they are not workspaces and keep their own
 * icon, so they are also excluded from collision handling (a workspace named
 * "lima" must not be pushed to "LI" by "Loose Files").
 */
export function workspaceRailGlyphs(
  instances: Array<{
    workspaceInstanceId: string;
    displayName: string;
    kind: string;
  }>
): Record<string, string> {
  const workspaces = instances.filter((i) => i.kind !== "loose");
  const sources = new Map(
    workspaces.map((i) => [i.workspaceInstanceId, glyphSource(i.displayName)])
  );

  // Grow every glyph together until each is unique or the cap is reached: a
  // per-instance loop would let one long name drag the others out with it.
  let length = 1;
  let glyphs = new Map<string, string>();
  for (; length <= MAX_GLYPH_LENGTH; length++) {
    glyphs = new Map(
      workspaces.map((i) => {
        const src = sources.get(i.workspaceInstanceId) ?? [];
        return [
          i.workspaceInstanceId,
          src.length === 0 ? FALLBACK_GLYPH : src.slice(0, length).join(""),
        ];
      })
    );
    const values = [...glyphs.values()];
    if (new Set(values).size === values.length) break;
  }

  return Object.fromEntries(glyphs);
}
