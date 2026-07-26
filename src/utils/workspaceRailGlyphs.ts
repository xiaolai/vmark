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

/** Grapheme count — what the user sees, unlike `String.length`. */
export function workspaceRailGlyphLength(glyph: string): number {
  return graphemes(glyph).length;
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
 * Each glyph is the shortest prefix unique **among the workspaces it actually
 * collides with**: `alpha`/`apex`/`zulu` yields "AL"/"AP"/"Z", not
 * "AL"/"AP"/"ZU". An earlier version grew every glyph whenever any pair
 * collided, needlessly lengthening names that were already unambiguous — and a
 * longer glyph is less legible in a 30px rail.
 *
 * KNOWN LIMIT: when names still collide at MAX_GLYPH_LENGTH — a strict prefix
 * (`app`/`apple`), a long shared prefix (`abcx`/`abcy`), or two identical names
 * — the colliding entries keep the same glyph. Forcing uniqueness would need a
 * suffix that neither fits nor reads in 30px. Those entries stay
 * distinguishable by their accent colour, their tooltip and their accessible
 * name, each of which carries the full workspace name.
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

  const glyphAt = (id: string, length: number): string => {
    const src = sources.get(id) ?? [];
    return src.length === 0 ? FALLBACK_GLYPH : src.slice(0, length).join("");
  };

  const result: Record<string, string> = {};
  // Start everyone at one grapheme, then extend ONLY the ids still sharing a
  // glyph. Ids that became unique are settled and never grow again.
  let pending = workspaces.map((i) => i.workspaceInstanceId);
  for (let length = 1; length <= MAX_GLYPH_LENGTH && pending.length > 0; length++) {
    const byGlyph = new Map<string, string[]>();
    for (const id of pending) {
      const glyph = glyphAt(id, length);
      const bucket = byGlyph.get(glyph);
      if (bucket) bucket.push(id);
      else byGlyph.set(glyph, [id]);
    }

    const stillColliding: string[] = [];
    for (const [glyph, ids] of byGlyph) {
      // Settle when unique, or when no member has anything longer left to
      // disambiguate with (a strict prefix cannot grow past its own length).
      const canGrow = ids.some((id) => (sources.get(id)?.length ?? 0) > length);
      if (ids.length === 1 || !canGrow) {
        for (const id of ids) result[id] = glyph;
      } else {
        stillColliding.push(...ids);
      }
    }
    pending = stillColliding;
  }

  // Reached the cap while still colliding — accept the shared glyph (KNOWN LIMIT).
  for (const id of pending) result[id] = glyphAt(id, MAX_GLYPH_LENGTH);

  return result;
}
