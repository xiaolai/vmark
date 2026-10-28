/**
 * Well-formed text — whether a string holds only complete UTF-16 surrogate
 * pairs, so it can cross into Rust without replacement.
 *
 * A lone surrogate cannot become UTF-8; the journal refuses it as
 * `INVALID_TEXT` rather than storing U+FFFD. A write checks its content
 * with this BEFORE it prepares, because content that the journal would
 * refuse at commit must never reach the editor.
 *
 * @module services/agentJournal/wellFormedText
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** True when `text` contains no unpaired surrogate. */
export function isWellFormedText(text: string): boolean {
  return !LONE_SURROGATE.test(text);
}
