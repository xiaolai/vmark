/**
 * Workspace rail identity glyphs.
 *
 * Split from workspaceIdentity.ts to keep that file under the 300-line gate
 * (rule 00: ratchet down, never raise a baseline). Self-contained and pure —
 * no store or React imports — so the edge cases (CJK, emoji, dotfiles,
 * colliding initials) are unit-tested directly.
 */

/** Shown when a name yields no usable character at all (e.g. "", "...", "   "). */
const FALLBACK_GLYPH = "?";

/**
 * Grapheme segmenter, so a glyph is never cut inside a user-perceived character.
 *
 * `Array.from` is code-point-safe but NOT grapheme-safe: it splits ZWJ emoji
 * (👨‍👩‍👧 → 👨), detaches skin-tone modifiers (👍🏽 → 👍) and separates a
 * decomposed accent from its base letter (é → e + ◌́), each of which renders
 * something the folder name does not contain.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((s) => s.segment);
}

/**
 * Graphemes of `name` from the first usable one onward, uppercased.
 *
 * Skips leading PUNCTUATION, SEPARATORS, format and standalone combining
 * characters only, so a dotfile-style root (`.config`) yields "C" rather than
 * ".". It deliberately does not require a letter or digit: an emoji is a
 * perfectly good identity glyph for a folder named "🚀 project", and skipping
 * past it to "P" would discard the most recognisable character in the name.
 *
 * `toUpperCase()` is intentionally locale-independent: the glyph comes from a
 * folder name whose language is unknown and unrelated to the user's locale, so
 * applying Turkish casing to an English name (or the reverse) would be
 * arbitrary rather than correct.
 */
function glyphSource(name: string): string[] {
  const chars = graphemes(name.trim().toUpperCase());
  const start = chars.findIndex((c) => !/^[\p{P}\p{Z}\p{C}\p{M}]+$/u.test(c));
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
 * **Exactly one grapheme, always.** An earlier version grew colliding glyphs to
 * the shortest unique prefix (`alpha`/`apex` → "AL"/"AP"). That was the wrong
 * trade: a 30px rail has to shrink a 2- or 3-character glyph to fit, so every
 * collision made the *colliding* entries harder to read in order to buy a
 * uniqueness the rail never needed. Identity is already carried three other
 * ways — the accent colour, the tooltip, and the accessible name — and each of
 * those has the full workspace name, not an abbreviation of it. So colliding
 * names simply share a letter, exactly as they do in Slack and VS Code profiles.
 *
 * Loose instances get NO glyph: they are not workspaces and keep their own icon.
 */
export function workspaceRailGlyphs(
  instances: Array<{
    workspaceInstanceId: string;
    displayName: string;
    kind: string;
  }>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const instance of instances) {
    if (instance.kind === "loose") continue;
    const [first] = glyphSource(instance.displayName);
    result[instance.workspaceInstanceId] = first ?? FALLBACK_GLYPH;
  }
  return result;
}
