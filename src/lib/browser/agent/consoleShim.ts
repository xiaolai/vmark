/**
 * Console capture (WI-P7.1) — Option C from the Phase 7 design review
 * (`dev-docs/grills/browser-automation/phase7-console-design.md`).
 *
 * A page-world shim overrides `console.*` and appends each call to a **capped ring
 * buffer** stored on a hidden DOM element. The isolated-world driver reads that
 * element with the ordinary eval primitive. The DOM is shared across content
 * worlds, so nothing here registers a `WKScriptMessageHandler` — **the no-bridge
 * invariant (R3) holds**: the page still has no channel into VMark.
 *
 * The shim runs in the PAGE's own world, so captured output is page-controlled and
 * **untrusted** — treat it exactly like a `read` result (never an act target). The
 * buffer is bounded so a chatty/hostile page can't grow the DOM without limit.
 *
 * `installConsoleCapture` is unit-tested here in jsdom.
 *
 * ⚠️ **IT IS NOT WHAT SHIPS.** The page-world shim that actually runs is a
 * SEPARATE, hand-maintained JavaScript copy in
 * `src-tauri/src/browser/console_shim_macos.rs` (`CONSOLE_SHIM_SRC`), injected
 * as a `WKUserScript` at AiSandbox tab creation. Two implementations of one
 * behaviour: this one is tested, that one is shipped, and nothing checks they
 * agree. The bounded buffer, the serialization fallbacks and the transparent
 * forwarding are therefore verified only in the copy users never execute.
 *
 * A `CONSOLE_SHIM` constant here used to embed this file's source for injection,
 * but nothing imported it — the Rust copy had already superseded it. It was
 * removed on 2026-08-09 (WI-DP1.2). An earlier version of this note claimed the
 * page-world half "was never registered", which was simply wrong: it is
 * registered, from Rust (audit 019fe61c).
 *
 * The real fix is one canonical asset — either Rust reads this file's compiled
 * output, or a parity test executes `CONSOLE_SHIM_SRC` against the same cases.
 * Until then, treat a change here as requiring the same change there.
 *
 * @coordinates-with src-tauri/src/browser/console_shim_macos.rs — the shipped copy
 *
 * @coordinates-with services/mcpBridge/v2/browserConsole.ts — the read handler
 * @module lib/browser/agent/consoleShim
 */

/** Id of the hidden DOM element that holds the JSON ring buffer. */
export const CONSOLE_BUFFER_ID = "__vmark_console_buffer";

/** Max characters kept per entry (defence against a page logging huge strings). */
const MAX_ENTRY_CHARS = 2000;

/**
 * Install the console-capture shim on `consoleObj`, buffering into a hidden element
 * in `doc`, keeping at most `cap` entries (ring buffer). Kept as a standalone,
 * dependency-free function so it is both unit-testable and embeddable as a string.
 */
export function installConsoleCapture(
  consoleObj: Record<string, (...args: unknown[]) => void>,
  doc: Document,
  cap: number,
): void {
  const ID = "__vmark_console_buffer";
  const MAX = 2000;
  const buf: Array<{ level: string; text: string }> = [];
  function el(): HTMLElement {
    let e = doc.getElementById(ID);
    if (!e) {
      e = doc.createElement("script");
      (e as HTMLScriptElement).type = "application/json";
      e.id = ID;
      e.style.display = "none";
      (doc.head || doc.documentElement).appendChild(e);
    }
    return e;
  }
  function push(level: string, args: IArguments | unknown[]): void {
    let text: string;
    try {
      text = Array.prototype.map
        .call(args, (a: unknown) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");
    } catch {
      text = "";
    }
    buf.push({ level, text: text.slice(0, MAX) });
    if (buf.length > cap) buf.shift();
    try {
      el().textContent = JSON.stringify(buf);
    } catch {
      /* DOM write failed — best-effort */
    }
  }
  ["log", "info", "warn", "error", "debug"].forEach((level) => {
    const orig = consoleObj[level];
    consoleObj[level] = function (this: unknown, ...args: unknown[]) {
      try {
        push(level, args);
      } catch {
        /* never let capture break the page's own logging */
      }
      if (typeof orig === "function") return orig.apply(consoleObj, args);
    };
  });
  void MAX_ENTRY_CHARS;
}

/**
 * Isolated-world script that reads (and optionally clears) the console ring buffer.
 * Returns `JSON.stringify({entries:[{level,text},...]})`. A page that cleared or
 * corrupted the buffer just yields `[]` — the reader never throws.
 */
export function buildConsoleReadScript(clear: boolean): string {
  return (
    `var e=document.getElementById(${JSON.stringify(CONSOLE_BUFFER_ID)});var b=[];` +
    `if(e){try{b=JSON.parse(e.textContent||"[]");}catch(x){}}` +
    (clear ? 'if(e)e.textContent="[]";' : "") +
    `return JSON.stringify({entries:b});`
  );
}
