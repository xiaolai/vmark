/**
 * runInTerminal
 *
 * Purpose: Send a fenced shell code block from the document into the
 * integrated terminal (F1/WI-4.3). VMark is a markdown editor full of `bash`
 * fences; this closes the copy-switch-paste loop.
 *
 * SECURITY BOUNDARY — read before changing anything here.
 *   This is the only path by which DOCUMENT CONTENT reaches a shell, and a
 *   document can arrive from anywhere (a clone, a download, an AI tool). The
 *   payload is *pasted into the input line* and must **never auto-execute**.
 *   Two separate things are required for that, and both are enforced here:
 *
 *   1. **No trailing line terminator.** A trailing "\n" IS an Enter press.
 *      `prepareShellBlock` strips trailing newlines and whitespace-only tail
 *      lines, and `\r` is removed outright.
 *   2. **No interior newline unless bracketed paste is active.** This is the
 *      subtle one. `term.paste()` rewrites every "\n" to "\r" before sending;
 *      when the shell has NOT enabled bracketed-paste mode, each "\r" is an
 *      Enter press, so a multi-line block would run line by line on arrival.
 *      Modern bash/zsh readline enables the mode, but "usually on" is not a
 *      security boundary — so a multi-line payload is never pasted while
 *      `term.modes.bracketedPasteMode` is false. A session created a moment
 *      ago legitimately has it off (its shell is still starting), so delivery
 *      WAITS within the retry budget and only then refuses. Single-line
 *      payloads carry no such risk and are always allowed.
 *
 *   Pressing Enter stays the user's decision, made while looking at the
 *   command. `runInTerminal.test.ts` asserts both rules.
 *
 * Key decisions:
 *   - Delivery goes through `term.paste()`, not `term.write()`. Paste applies
 *     bracketed-paste wrapping when the shell enabled it, so a multi-line
 *     block lands in the input line as one editable unit (the G2 invariant of
 *     the 2026-06-01 plan).
 *   - Transcript fences (`console`, `shell-session`) keep only their PROMPTED
 *     lines. Such a block interleaves commands with their output; pasting the
 *     output too would leave `PASS` sitting on the input line as a second
 *     command.
 *   - The delivery target is pinned to a SESSION ID, not "whichever session is
 *     active when the retry fires". A newly created session's xterm is mounted
 *     by a React effect, so delivery is necessarily deferred — and the user
 *     can switch tabs in that window.
 *   - The result is a promise that resolves only once delivery succeeded or
 *     provably failed, so a caller can tell the user when nothing happened.
 *
 * @coordinates-with services/terminal/activeTerminal.ts — getTerminalForSession
 * @coordinates-with services/terminal/revealTerminalSession.ts — session + panel
 * @coordinates-with plugins/codeBlockLineNumbers/nodeView.ts — the run button
 * @module services/terminal/runInTerminal
 */
import { getTerminalForSession, type RunTargetTerminal } from "./activeTerminal";
import { reuseOrCreateTerminalSession } from "./revealTerminalSession";
import { terminalLog } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";

/** Fences that hold a session TRANSCRIPT, where prompts are decoration. */
const TRANSCRIPT_LANGUAGES = new Set([
  "console",
  "shell-session",
  "shellsession",
  "terminal",
]);

/** Fences whose whole body is shell source. */
const COMMAND_LANGUAGES = new Set(["bash", "sh", "zsh", "shell"]);

/**
 * Every fence info string we offer to run. Derived from the two sets above so
 * adding a transcript language cannot silently leave it unrunnable (or vice
 * versa). Matched exactly after trim + lowercase — `bashrc` and `powershell`
 * are deliberately NOT matched, since a substring match would put a run button
 * on blocks that are not commands for THIS shell.
 */
const SHELL_LANGUAGES = new Set([...COMMAND_LANGUAGES, ...TRANSCRIPT_LANGUAGES]);

/** A line that begins with a shell prompt, capturing what follows it. */
const PROMPT_LINE = /^\s*[$%#] (.*)$/;

/** True when a fence's info string marks it as shell commands. */
export function isShellLanguage(language: string | null | undefined): boolean {
  if (!language) return false;
  return SHELL_LANGUAGES.has(language.trim().toLowerCase());
}

/** True when a fence's body is a transcript rather than plain shell source. */
export function isTranscriptLanguage(language: string): boolean {
  return TRANSCRIPT_LANGUAGES.has(language.trim().toLowerCase());
}

/**
 * Keep only the COMMANDS from a transcript, dropping the interleaved output.
 *
 * A `console` block reads:
 *   $ npm test
 *   PASS  src/foo.test.ts
 * Only the first line is something to run. Earlier this function merely
 * stripped the `$ `, which left `PASS …` in the payload as a second command.
 *
 * The trailing SPACE in the prompt pattern is required: `$HOME/bin` is a
 * variable and `#comment` is a comment — neither is a prompt.
 *
 * A transcript with NO prompt lines at all is treated as plain source (some
 * authors tag a bare command list `console`), so nothing is silently lost.
 */
export function extractTranscriptCommands(source: string): string {
  const commands = source
    .split("\n")
    .map((line) => PROMPT_LINE.exec(line)?.[1])
    .filter((cmd): cmd is string => cmd !== undefined);
  return commands.length > 0 ? commands.join("\n") : source;
}

/**
 * Strip trailing line terminators and whitespace-only tail lines, leaving the
 * final content line untouched. Trailing spaces on a real command are
 * meaningful after a line continuation, so they are preserved — only the
 * newlines that would press Enter are removed.
 */
function stripTrailingBlankLines(source: string): string {
  const lines = source.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/**
 * Turn a fence's raw contents into the exact bytes to paste: transcript
 * commands only (for transcript fences), no `\r`, and no trailing newline.
 */
export function prepareShellBlock(source: string, language: string): string {
  const body = isTranscriptLanguage(language)
    ? extractTranscriptCommands(source)
    : source;
  // `\r` is removed outright: term.paste would forward it as an Enter press.
  return stripTrailingBlankLines(body.replace(/\r/g, ""));
}

/** Why a run request was not delivered. */
export type RunInTerminalFailure =
  | "not-shell"
  | "empty"
  /** Multi-line payload, and the shell has not enabled bracketed paste. */
  | "unsafe-multiline"
  /** The session's terminal never became reachable. */
  | "timeout"
  /** `paste` itself threw (session disposed mid-delivery). */
  | "paste-failed";

export interface RunInTerminalResult {
  ok: boolean;
  reason?: RunInTerminalFailure;
}

/** How many frames to wait for a freshly created session's xterm to mount. */
const READY_RETRY_FRAMES = 60;

/**
 * True when this payload can be delivered without any chance of executing.
 * See SECURITY BOUNDARY rule 2 — a single-line payload is always safe.
 */
export function isSafeToPaste(payload: string, term: RunTargetTerminal): boolean {
  if (!payload.includes("\n")) return true;
  return term.modes.bracketedPasteMode === true;
}

/**
 * Resolve `sessionId`'s terminal and paste, retrying across frames while the
 * session's xterm mounts. Bounded so a session that never appears cannot spin
 * forever.
 */
function deliver(
  sessionId: string,
  payload: string,
): Promise<RunInTerminalResult> {
  return new Promise((resolve) => {
    const attempt = (frame: number) => {
      const term = getTerminalForSession(sessionId);
      if (!term) {
        if (frame >= READY_RETRY_FRAMES) {
          terminalLog(
            `run-in-terminal: session ${sessionId} never became reachable; payload dropped`,
          );
          resolve({ ok: false, reason: "timeout" });
          return;
        }
        requestAnimationFrame(() => attempt(frame + 1));
        return;
      }

      if (!isSafeToPaste(payload, term)) {
        // A session created moments ago has bracketed paste OFF simply because
        // its shell has not finished starting — that is the common "no
        // terminal open yet" path, not a hostile shell. Keep waiting within
        // the same budget, and only refuse once it is clear the shell is not
        // going to enable it.
        if (frame < READY_RETRY_FRAMES) {
          requestAnimationFrame(() => attempt(frame + 1));
          return;
        }
        // Refusing is the whole point: with bracketed paste off, the interior
        // newlines would run as commands the moment they arrive.
        terminalLog(
          "run-in-terminal: refused a multi-line block — the shell has not " +
            "enabled bracketed paste, so pasting it would execute it",
        );
        resolve({ ok: false, reason: "unsafe-multiline" });
        return;
      }

      try {
        term.paste(payload);
        // Focus so the user's Enter reaches the shell, not the document.
        term.focus();
        resolve({ ok: true });
      } catch (error: unknown) {
        // A session disposed mid-paste must not throw into a click handler.
        terminalLog("run-in-terminal paste failed:", errorMessage(error));
        resolve({ ok: false, reason: "paste-failed" });
      }
    };
    attempt(0);
  });
}

/**
 * Send a shell code block to the terminal, creating a session and revealing
 * the panel if needed. The payload is pasted, NEVER executed. Resolves only
 * once delivery has succeeded or provably failed.
 */
export function runInTerminal(
  source: string,
  language: string,
): Promise<RunInTerminalResult> {
  if (!isShellLanguage(language)) {
    return Promise.resolve({ ok: false, reason: "not-shell" });
  }

  const payload = prepareShellBlock(source, language);
  if (!payload) return Promise.resolve({ ok: false, reason: "empty" });

  // Always yields a session: reuse when the panel has one, create otherwise.
  return deliver(reuseOrCreateTerminalSession(), payload);
}
