/**
 * revealInvisibleChars — make characters that draw nothing visible in an approval
 * prompt, so the user authorizes the text that will actually be used.
 *
 * Purpose: every surface that asks the user to authorize agent- or file-supplied
 * text (the browser, workflow-step and workspace approval dialogs) shows it through
 * this one function. A display transform only: the caller binds and executes the
 * original string.
 *
 * @coordinates-with components/Browser/approvalDialogFormat — browser prompt fields
 * @coordinates-with components/WorkflowApproval/ApprovalDialog — workflow step prompt
 * @coordinates-with components/Workspace/WorkspaceApprovalDialog — folder prompt
 * @module utils/revealInvisibleChars
 */

/** Every character that draws nothing yet still reaches its destination. Category
 *  Cf covers bidi embeddings, overrides, isolates and marks, which can visually reorder what the user
 *  believes they are authorizing even inside `<bdi>`, plus zero-width spaces/joiners,
 *  word joiner, BOM and soft hyphen (`10\u200B000` reads as `10000`). Unicode's
 *  Default_Ignorable_Code_Point adds the invisibles outside Cf: variation selectors and
 *  the combining grapheme joiner (Mn), the Hangul fillers (Lo), the Mongolian and Khmer
 *  invisibles. U+2800 BRAILLE PATTERN BLANK is in neither property yet draws only a
 *  blank, so it is named. Visible combining marks (an accent, Mn) stay as they are. For
 *  DISPLAY each becomes a visible `\u{…}` escape; the caller binds and runs the original text.
 *  Standard properties, so no hand list lags the standard. Emoji ZWJ sequences and
 *  emoji presentation selectors show as escapes: in a security prompt, exactness wins
 *  over glyph shaping. */
const INVISIBLE_CHAR = /[\p{Cf}\p{Default_Ignorable_Code_Point}\u2800]/gu;

/** `text` with every invisible character shown as a visible escape, uncut. */
export function revealInvisibleChars(text: string): string {
  return text.replace(INVISIBLE_CHAR, (ch) => `\\u{${ch.codePointAt(0)?.toString(16).toUpperCase()}}`);
}
