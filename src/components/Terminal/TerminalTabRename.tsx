/**
 * TerminalTabRename
 *
 * Purpose: The inline rename text box that replaces a terminal tab while the
 * user is editing its name (WI-4.1). Extracted from TerminalTabBar so that
 * file keeps its single responsibility and stays under the size limit.
 *
 * Key decisions:
 *   - **Commit on Enter and on blur; cancel on Escape.** Blur-cancels would
 *     silently discard whatever the user typed the moment they clicked back
 *     into the terminal, which is the most likely next action. An accidental
 *     rename is trivially undone; lost typing is not recoverable.
 *   - Escape sets a ref BEFORE unmounting, because unmounting fires blur —
 *     without the guard the blur handler would commit exactly the text the
 *     user just discarded.
 *   - IME-safe: an Enter that commits a CJK candidate must end the
 *     composition, not the rename. Both IME markers are checked (the
 *     `isComposing` flag and the legacy keyCode 229) via `isImeKeyEvent`.
 *   - Empty / whitespace-only input cancels rather than committing a blank
 *     tab, and the committed name is trimmed and length-capped — the same
 *     hygiene `terminalSetProgramTitle` applies to program-supplied titles.
 *
 * @coordinates-with TerminalTabBar.tsx — sole caller
 * @coordinates-with stores/uiStore/terminalSlice.ts — terminalRenameSession sets isUserRenamed
 * @module components/Terminal/TerminalTabRename
 */
import { useCallback, useRef, useState } from "react";
import { isImeKeyEvent } from "@/utils/imeGuard";

/** Upper bound on a session name, mirroring the program-title cap. */
export const MAX_SESSION_NAME_LENGTH = 256;

/**
 * Normalize a typed name into something worth storing. Returns null when the
 * input carries no name at all (empty, whitespace, or control-only).
 */
export function normalizeSessionName(raw: string): string | null {
  // Drop C0 controls, DEL, and the C1 range (a pasted name can carry any of
  // them — U+0080–U+009F are invisible and some terminals treat them as
  // escape introducers), then collapse runs of whitespace and trim.
  //
  // Tab / LF / CR are deliberately NOT dropped here: they are whitespace, not
  // hidden control junk, so they must reach the collapse below and become a
  // single space. Filtering them out instead would silently weld the words of
  // a pasted multi-line name together ("a\n\nb" → "ab").
  const cleaned = Array.from(raw)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      if (c === 0x09 || c === 0x0a || c === 0x0d) return true;
      return c > 0x1f && c !== 0x7f && !(c >= 0x80 && c <= 0x9f);
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // Truncate by CODE POINT, not UTF-16 code unit: `.slice()` on a string can
  // cut a surrogate pair in half and store a lone surrogate.
  const points = Array.from(cleaned);
  return points.length <= MAX_SESSION_NAME_LENGTH
    ? cleaned
    : points.slice(0, MAX_SESSION_NAME_LENGTH).join("");
}

interface TerminalTabRenameProps {
  /** The name shown before editing — the input's starting value. */
  initialName: string;
  /** Accessible label for the text box. */
  label: string;
  /** Called with the normalized name; not called when the input is blank. */
  onCommit: (name: string) => void;
  /** Called when the edit ends, committed or not, so the caller can exit edit mode. */
  onDone: () => void;
}

/** Inline text box for renaming a terminal session tab. */
export function TerminalTabRename({
  initialName,
  label,
  onCommit,
  onDone,
}: TerminalTabRenameProps) {
  const [value, setValue] = useState(initialName);
  // Set before unmounting on Escape so the resulting blur cannot commit.
  const cancelledRef = useRef(false);
  // Enter commits and unmounts; if the environment then also delivers a blur,
  // `commit` must not fire the store action a second time.
  const committedRef = useRef(false);

  const commit = useCallback(() => {
    if (cancelledRef.current || committedRef.current) return;
    committedRef.current = true;
    const name = normalizeSessionName(value);
    if (name) onCommit(name);
    onDone();
  }, [value, onCommit, onDone]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isImeKeyEvent(e.nativeEvent)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelledRef.current = true;
        onDone();
      }
    },
    [commit, onDone],
  );

  return (
    <input
      className="terminal-tab terminal-tab-rename"
      // Autofocus is correct here: the box only exists because the user just
      // double-clicked to type in it, and it disappears when they leave.
      autoFocus
      type="text"
      aria-label={label}
      value={value}
      maxLength={MAX_SESSION_NAME_LENGTH}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      // A click inside the box must not re-trigger the tab's own handlers.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
