/**
 * setupOsc
 *
 * Purpose: Registers OSC (Operating System Command) escape-sequence handlers on
 * an xterm.js Terminal. Handles OSC 7 (current working directory) and OSC 133
 * (FinalTerm command boundaries) — both emitted by the shell-integration rc
 * (WI-3.1). OSC 7 feeds relative file-link resolution + "new terminal here"
 * (WI-2.x); OSC 133 builds a list of command marks (prompt line + exit code)
 * that drive prompt navigation (WI-3.3) and exit-status decorations (WI-3.4).
 *
 * Also exposes `commandOutputRange` / `readBufferRange` (WI-4.4): the pure
 * arithmetic that turns a clicked buffer line into the output span of the
 * command that produced it, excluding its prompt line.
 *

 *
 * Key decisions:
 *   - OSC 7 payload is `file://<host>/<path>`. We use the path regardless of
 *     host (matches VS Code / iTerm2 behavior); SSH'd remote cwds still update
 *     the displayed path, which is the least-surprising choice.
 *   - `parseOsc7Cwd` is a pure function so it is unit-tested without a Terminal.
 *   - The handler returns `true` (handled) so xterm doesn't warn about an
 *     unrecognized sequence. Handlers are owned by the term's parser and torn
 *     down when the term is disposed — no explicit cleanup needed.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller; exposes getCwd()
 * @coordinates-with fileLinkProvider.ts — consumes the live cwd for relative paths
 * @module components/Terminal/setupOsc
 */
import type { Terminal, IMarker, IDecoration } from "@xterm/xterm";

/**
 * Parse an OSC 7 payload (`file://host/path`) into an absolute filesystem path.
 * Returns null if the payload isn't a well-formed `file://` URL.
 */
export function parseOsc7Cwd(data: string): string | null {
  if (!data.startsWith("file://")) return null;
  try {
    const url = new URL(data);
    const path = decodeURIComponent(url.pathname);
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/** Live state exposed by the OSC handlers. */
export interface OscHandle {
  /** The shell's last-reported cwd (OSC 7), or null if never reported. */
  getCwd: () => string | null;
}

/** Register OSC 7 (cwd) handling on a Terminal and expose the live cwd. */
export function setupOsc7(term: Terminal): OscHandle {
  let cwd: string | null = null;
  term.parser.registerOscHandler(7, (data) => {
    const parsed = parseOsc7Cwd(data);
    if (parsed) cwd = parsed;
    return true; // handled — suppress xterm's unknown-OSC warning
  });
  return { getCwd: () => cwd };
}

/**
 * A single shell command, located by an xterm Marker at its prompt line.
 * The marker tracks the line as the buffer scrolls and self-removes when the
 * line falls out of scrollback.
 */
export interface CommandMark {
  /** Marker at the prompt line (OSC 133;A). */
  marker: IMarker;
  /** Exit code from OSC 133;D;<code>, or undefined while the command runs. */
  exitCode?: number;
  /** Exit-status gutter decoration (WI-3.4), created once the code is known. */
  decoration?: IDecoration;
}

/** Live command-boundary state exposed by the OSC 133 handler. */
export interface Osc133Handle {
  /** Commands in buffer order (oldest first), excluding scrolled-out ones. */
  getCommands: () => CommandMark[];
  /** True between command pre-exec (133;C) and done (133;D) — i.e. a foreground
   *  command is running and the shell is NOT idle at a prompt. False without
   *  shell integration. */
  isRunning: () => boolean;
  /** Register a callback fired each time the shell returns to idle (a new
   *  prompt / command done). Used to flush deferred work (e.g. a pending
   *  workspace `cd`) that was skipped while a foreground command ran. Pass
   *  null to clear. */
  setOnIdle: (cb: (() => void) | null) => void;
}

/**
 * Register OSC 133 (FinalTerm) command-boundary handling. The integration rc
 * (WI-3.1) emits, per prompt: `133;D;<code>` (previous command done), `133;A`
 * (new prompt start). So on `A` we open a command mark at the prompt line; on
 * `D;<code>` we record the exit code of the command being closed.
 */
export function setupOsc133(term: Terminal): Osc133Handle {
  let commands: CommandMark[] = [];
  let current: CommandMark | null = null;
  let running = false;
  let onIdle: (() => void) | null = null;

  term.parser.registerOscHandler(133, (data) => {
    const sep = data.indexOf(";");
    const type = sep === -1 ? data : data.slice(0, sep);
    const rest = sep === -1 ? "" : data.slice(sep + 1);

    if (type === "C") {
      // Command started executing — shell is busy until the matching D.
      running = true;
    } else if (type === "A") {
      const wasRunning = running;
      running = false;
      // Returned to a prompt: flush any deferred idle work (e.g. pending cd).
      if (wasRunning) onIdle?.();
      // New prompt — mark its line and start a fresh command.
      const marker = term.registerMarker(0);
      if (marker) {
        const mark: CommandMark = { marker };
        commands.push(mark);
        current = mark;
        // Self-remove when the line scrolls out of the buffer.
        marker.onDispose(() => {
          commands = commands.filter((c) => c !== mark);
          if (current === mark) current = null;
        });
      }
    } else if (type === "D") {
      // Command finished — back to idle; `rest` is the exit code (may be empty).
      const wasRunning = running;
      running = false;
      // Done transition is the reliable "shell is idle now" signal (the rc
      // emits D then A); flush deferred idle work here.
      if (wasRunning) onIdle?.();
      if (current && rest !== "") {
        const code = parseInt(rest, 10);
        if (!Number.isNaN(code)) {
          current.exitCode = code;
          decorateCommand(term, current); // WI-3.4 exit-status gutter mark
        }
      }
      // Close the command: its exit code is immutable until the next prompt, so
      // a stray repeat `D;<code>` can't overwrite it. `current` reopens on `A`.
      current = null;
    }
    return true; // handled
  });

  return {
    getCommands: () => commands,
    isRunning: () => running,
    setOnIdle: (cb) => {
      onIdle = cb;
    },
  };
}

/**
 * Add an exit-status gutter decoration to a command's prompt line (WI-3.4):
 * a thin left bar, green for success / red for failure. Styled via CSS classes
 * (tokens) in terminal-panel.css. The decoration is tied to the marker and is
 * disposed automatically when the marker scrolls out.
 */
function decorateCommand(term: Terminal, cmd: CommandMark): void {
  if (cmd.decoration || cmd.exitCode === undefined) return;
  const decoration = term.registerDecoration({ marker: cmd.marker });
  if (!decoration) return;
  cmd.decoration = decoration;
  const ok = cmd.exitCode === 0;
  decoration.onRender((el: HTMLElement) => {
    el.classList.add("vmark-cmd-status", ok ? "vmark-cmd-ok" : "vmark-cmd-fail");
  });
}

/**
 * Scroll the terminal to the previous/next command prompt relative to the
 * current viewport (WI-3.3). No-op when there are no command marks.
 */
export function scrollToAdjacentCommand(
  term: Terminal,
  commands: CommandMark[],
  direction: "prev" | "next",
): void {
  const lines = commands
    .map((c) => c.marker.line)
    .filter((l) => l >= 0)
    .sort((a, b) => a - b);
  if (lines.length === 0) return;
  const top = term.buffer.active.viewportY;
  const target =
    direction === "prev"
      ? [...lines].reverse().find((l) => l < top)
      : lines.find((l) => l > top);
  if (target !== undefined) term.scrollToLine(target);
}

/* ─────────────────── command output range (WI-4.4) ─────────────────── */

/** An inclusive buffer-line span. */
export interface CommandRange {
  /** First line of the command's OUTPUT (the prompt line is excluded). */
  startLine: number;
  /** Last line of the output, inclusive. */
  endLine: number;
}

/**
 * The output range of the command containing `line` (WI-4.4 / F4).
 *
 * The OSC 133 `A` marks sit on PROMPT lines, so a command's output is
 * everything strictly after its own mark and strictly before the next one.
 * The last (still open) command runs to `lastBufferLine`.
 *
 * Returns null when there is nothing to copy: no marks at all (shell
 * integration off), a click above the first prompt, or a command that
 * produced no output.
 *
 * Pure — takes plain line numbers so it is unit-testable without a terminal.
 */
export function commandOutputRange(
  commands: CommandMark[],
  line: number,
  lastBufferLine: number,
): CommandRange | null {
  const lines = commands
    .map((c) => c.marker.line)
    // A disposed marker reports a negative line; it is no longer in the buffer.
    .filter((l) => l >= 0)
    .sort((a, b) => a - b);
  if (lines.length === 0) return null;

  // The prompt at or above the clicked line owns it.
  let ownerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] <= line) ownerIndex = i;
    else break;
  }
  if (ownerIndex === -1) return null; // clicked above the first prompt

  const startLine = lines[ownerIndex] + 1; // skip the prompt line itself
  const next = lines[ownerIndex + 1];
  const endLine = next === undefined ? lastBufferLine : next - 1;
  if (endLine < startLine) return null; // command produced no output
  return { startLine, endLine };
}

/**
 * Read an inclusive buffer-line span as text, trimming trailing padding from
 * each line (xterm reports cells, not characters) and dropping trailing blank
 * lines. Returns "" when the range holds nothing.
 */
export function readBufferRange(term: Terminal, range: CommandRange): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let y = range.startLine; y <= range.endLine; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    lines.push(line.translateToString(true).replace(/\s+$/, ""));
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
