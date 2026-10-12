/**
 * setupFloatingPrompt — keep the input rows visible while the user reads
 * scrollback, by floating a live mirror of them over the terminal's bottom.
 *
 * Purpose: In a terminal the "input bar" is just the rows around the cursor,
 * so scrolling back to read earlier output hides it, and typing used to snap
 * the viewport back down. With `scrollOnUserInput` off (terminalOptions.ts)
 * the viewport stays put, and this overlay shows what is being typed.
 *
 * Key decisions:
 *   - A MIRROR, not a second input. Keys still go to xterm's own textarea, so
 *     tab completion, history, Ctrl-C, readline keys and the IME composition
 *     gate are untouched — the overlay never owns text input.
 *   - mousedown on the overlay is preventDefaulted so clicking it never steals
 *     focus from the terminal; its button jumps the viewport to the bottom.
 *   - Submitting jumps too: a keystroke that is exactly Enter (`\r`, or
 *     `\r\n` in linefeed mode) or Ctrl+C (`\x03`) scrolls to the bottom, so the
 *     result of the command — or of the prompt sent to a TUI — is in view.
 *     Exact match on purpose: Shift+Enter (CSI-u newline inside a TUI's
 *     input box), pastes and every other key keep the viewport still.
 *   - Which rows: floatingPromptRange.ts. How they look: floatingPromptCells.ts
 *     (data only — rows are built with textContent, never innerHTML).
 *   - Cursor visibility (DECTCEM, `CSI ? 25 h/l`) is observed with parser hooks
 *     that return false, so xterm still handles the sequence. A TUI that hides
 *     the real cursor and paints its own (Claude Code) shows only its own.
 *   - Renders are coalesced to one per animation frame. Events: scroll,
 *     parsed writes, cursor moves, resize, buffer switch, and wheel on the
 *     container as a belt-and-braces scroll signal.
 *   - Colours, font and palette are read from `term.options` at render time,
 *     so live theme / font changes need no extra wiring.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller (one per session)
 * @coordinates-with terminalOptions.ts — scrollOnUserInput: false
 * @coordinates-with terminal-panel.css — .terminal-floating-prompt styles
 * @module components/Terminal/setupFloatingPrompt
 */

import type { ITheme, Terminal } from "@xterm/xterm";
import i18n from "@/i18n";
import { resolveFloatingPromptRange } from "./floatingPromptRange";
import { buildAnsiPalette, lineToRuns, type PromptColors, type PromptRun } from "./floatingPromptCells";

interface SetupOptions {
  term: Terminal;
  container: HTMLElement;
  /** Render scheduler; defaults to one requestAnimationFrame per burst. */
  schedule?: (fn: () => void) => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** onData payloads that submit input or interrupt, and so return to the prompt. */
const SUBMIT_KEYS: ReadonlySet<string> = new Set(["\r", "\r\n", "\x03"]);

/** Lucide's arrow-down-to-line, built as DOM so no markup string is parsed. */
function jumpIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "14", height: "14", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) {
    svg.setAttribute(k, v);
  }
  for (const d of ["M12 17V3", "m6 11 6 6 6-6", "M19 21H5"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

function runSpan(run: PromptRun): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = run.text;
  span.style.color = run.fg;
  if (run.bg) span.style.backgroundColor = run.bg;
  if (run.bold) span.style.fontWeight = "bold";
  if (run.italic) span.style.fontStyle = "italic";
  if (run.underline) span.style.textDecoration = "underline";
  if (run.dim) span.style.opacity = "0.5";
  if (run.cursor) span.className = "terminal-floating-prompt-cursor";
  return span;
}

/** Attach the floating prompt to one terminal instance. Returns a cleanup. */
export function setupFloatingPrompt({ term, container, schedule }: SetupOptions): () => void {
  let cursorVisible = true;
  let pending = false;
  let disposed = false;
  let rafId: number | null = null;
  let paletteTheme: ITheme | undefined;
  let palette: string[] = buildAnsiPalette({});

  const overlay = document.createElement("div");
  overlay.className = "terminal-floating-prompt";
  overlay.hidden = true;
  const rowsEl = document.createElement("div");
  rowsEl.className = "terminal-floating-prompt-rows";
  rowsEl.setAttribute("aria-hidden", "true");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-floating-prompt-jump";
  button.appendChild(jumpIcon());
  overlay.append(rowsEl, button);
  if (!container.style.position) container.style.position = "relative";
  container.appendChild(overlay);

  const colors = (): PromptColors => {
    const theme = term.options.theme ?? {};
    if (theme !== paletteTheme) {
      paletteTheme = theme;
      palette = buildAnsiPalette(theme);
    }
    return { foreground: theme.foreground ?? "#000000", background: theme.background ?? "#ffffff", palette };
  };

  const render = () => {
    pending = false;
    rafId = null;
    if (disposed) return;
    const range = resolveFloatingPromptRange(term, { maxRows: Math.max(1, Math.floor(term.rows / 3)) });
    if (!range) {
      overlay.hidden = true;
      return;
    }
    const buffer = term.buffer.active;
    const resolved = colors();
    const rows: HTMLElement[] = [];
    for (let row = range.start; row <= range.end; row++) {
      const line = buffer.getLine(row);
      const rowEl = document.createElement("div");
      rowEl.className = "terminal-floating-prompt-row";
      if (line) {
        const cursorX = row === range.cursorRow && cursorVisible ? buffer.cursorX : undefined;
        rowEl.append(...lineToRuns(line, resolved, cursorX === undefined ? {} : { cursorX }).map(runSpan));
      }
      rows.push(rowEl);
    }
    rowsEl.replaceChildren(...rows);
    const label = i18n.t("statusbar:terminal.floatingPrompt.jumpToPrompt");
    button.setAttribute("aria-label", label);
    button.title = label;
    overlay.style.fontFamily = term.options.fontFamily ?? "";
    overlay.style.fontSize = `${term.options.fontSize ?? 13}px`;
    overlay.style.lineHeight = String(term.options.lineHeight ?? 1.2);
    overlay.style.color = resolved.foreground;
    overlay.style.backgroundColor = resolved.background;
    overlay.hidden = false;
  };

  const requestRender = () => {
    if (pending || disposed) return;
    pending = true;
    if (schedule) schedule(render);
    else rafId = requestAnimationFrame(render);
  };

  const setCursorVisibility = (visible: boolean) => (params: (number | number[])[]) => {
    if (params.includes(25)) {
      cursorVisible = visible;
      requestRender();
    }
    return false;
  };

  const onMouseDown = (event: MouseEvent) => event.preventDefault();
  const onJump = () => {
    term.scrollToBottom();
    requestRender();
  };
  overlay.addEventListener("mousedown", onMouseDown);
  button.addEventListener("click", onJump);
  container.addEventListener("wheel", requestRender, { passive: true });

  const subscriptions = [
    term.onData((data) => {
      if (SUBMIT_KEYS.has(data)) onJump();
    }),
    term.onScroll(requestRender),
    term.onWriteParsed(requestRender),
    term.onCursorMove(requestRender),
    term.onResize(requestRender),
    term.buffer.onBufferChange(requestRender),
    term.parser.registerCsiHandler({ prefix: "?", final: "h" }, setCursorVisibility(true)),
    term.parser.registerCsiHandler({ prefix: "?", final: "l" }, setCursorVisibility(false)),
    // RIS (full reset) shows the cursor again.
    term.parser.registerEscHandler({ final: "c" }, () => {
      cursorVisible = true;
      return false;
    }),
  ];
  requestRender();

  return () => {
    disposed = true;
    if (rafId !== null) cancelAnimationFrame(rafId);
    for (const subscription of subscriptions) subscription.dispose();
    overlay.removeEventListener("mousedown", onMouseDown);
    button.removeEventListener("click", onJump);
    container.removeEventListener("wheel", requestRender);
    overlay.remove();
  };
}
