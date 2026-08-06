/**
 * terminalInputTrace
 *
 * Purpose: dev-only recorder for the DOM input side of the terminal seam.
 * `attachInputTrace` captures the keydown/input/composition sequence and the
 * helper textarea's value at each step — the part that reveals the input
 * ARBITRATION decision — so real IME traces can be recorded by a human typing
 * (plan WI-0.1/WI-0.3) instead of synthesised from reading code (synthesised
 * fixtures reproduce the exact defect the audit found).
 *
 * Scope note: it does NOT observe `term.onData` or `pty.write` — those are the
 * OUTPUT side and must be tapped separately (the record type keeps "onData" /
 * "pty.write" kinds so a caller CAN push them, but the DOM tap here does not).
 *
 * This is a RECORDER, not a replay harness. Replay against a real xterm needs a
 * browser test tier (jsdom cannot model the listener/microtask boundary — plan
 * Q1/Q3); this module's own buffer/serialization logic IS unit-testable in jsdom.
 *
 * Usage (dev only): enable with `localStorage.setItem("vmark:trace-input","1")`
 * then reload; type; read `window.__vmarkInputTrace.snapshot()` in DevTools, or
 * call `.download()` to save a fixture JSON. Compiles to nothing in production.
 *
 * @coordinates-with createTerminalInstance.ts — optional dev-only attach point
 * @module components/Terminal/terminalInputTrace
 */
import { isDev } from "@/utils/debug/internals";

/** One recorded step in a keystroke's journey. Field set mirrors the fixture
 *  schema WI-0.3 requires (audit "unknowable" list). */
export interface InputTraceRecord {
  /** Monotonic-ish ms since the trace started (performance.now delta). */
  t: number;
  /** Event/marker kind: a DOM event type, or "onData" / "pty.write". */
  kind: string;
  /** The helper textarea's value at the moment this record was taken. */
  taValue?: string;
  data?: string | null;
  inputType?: string;
  isComposing?: boolean;
  composed?: boolean;
  eventPhase?: number;
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** Payload for "onData" / "pty.write" markers. */
  payload?: string;
}

/** A recording session: a bounded ring buffer with snapshot/clear. */
export interface InputTrace {
  record: (r: InputTraceRecord) => void;
  /** Convenience: stamp `t` from the trace clock and push. */
  mark: (r: Omit<InputTraceRecord, "t">) => void;
  snapshot: () => InputTraceRecord[];
  clear: () => void;
  /** Elapsed ms since the trace started. */
  now: () => number;
}

const DEFAULT_CAP = 500;

/**
 * Create a recording session. `clock` defaults to `performance.now` but is
 * injectable so tests can drive a deterministic clock (no reliance on real time).
 */
export function createInputTrace(
  cap: number = DEFAULT_CAP,
  clock: () => number = () => performance.now(),
): InputTrace {
  const buf: InputTraceRecord[] = [];
  const t0 = clock();
  const now = () => +(clock() - t0).toFixed(1);
  const record = (r: InputTraceRecord) => {
    if (buf.length >= cap) buf.shift();
    buf.push(r);
  };
  return {
    record,
    mark: (r) => record({ ...r, t: now() }),
    snapshot: () => buf.slice(),
    clear: () => {
      buf.length = 0;
    },
    now,
  };
}

const INPUT_EVENT_TYPES = [
  "keydown",
  "keypress",
  "keyup",
  "beforeinput",
  "input",
  "compositionstart",
  "compositionupdate",
  "compositionend",
] as const;

/** Serialize a DOM event into a trace record (pure — unit-testable). */
export function recordFromEvent(
  type: string,
  e: Event,
  taValue: string,
  t: number,
): InputTraceRecord {
  const rec: InputTraceRecord = { t, kind: type, taValue, eventPhase: e.eventPhase };
  if (e instanceof KeyboardEvent) {
    rec.key = e.key;
    rec.code = e.code;
    rec.keyCode = e.keyCode;
    rec.isComposing = e.isComposing;
    rec.ctrlKey = e.ctrlKey;
    rec.metaKey = e.metaKey;
    rec.altKey = e.altKey;
    rec.shiftKey = e.shiftKey;
  }
  if (typeof InputEvent !== "undefined" && e instanceof InputEvent) {
    rec.data = e.data;
    rec.inputType = e.inputType;
    rec.isComposing = e.isComposing;
    rec.composed = e.composed;
  }
  if (typeof CompositionEvent !== "undefined" && e instanceof CompositionEvent) {
    rec.data = e.data;
  }
  return rec;
}

interface AttachOptions {
  textarea: HTMLTextAreaElement;
  /** Optional: also record raw PTY-echo bytes if the caller can supply them. */
  trace: InputTrace;
}

/**
 * Attach capture-phase listeners to the textarea that feed the trace. Returns a
 * teardown fn. Capture phase so we observe the event before xterm; we never
 * call preventDefault/stopPropagation — this is a passive tap.
 */
export function attachInputTrace({ textarea, trace }: AttachOptions): () => void {
  const handlers: Array<[string, EventListener]> = [];
  for (const type of INPUT_EVENT_TYPES) {
    const h: EventListener = (e) => {
      trace.record(recordFromEvent(type, e, textarea.value, trace.now()));
    };
    textarea.addEventListener(type, h, true);
    handlers.push([type, h]);
  }
  return () => {
    for (const [type, h] of handlers) textarea.removeEventListener(type, h, true);
  };
}

/**
 * Dev-only turnkey install. No-op in production and unless the localStorage
 * flag is set. Wires the tap, exposes `window.__vmarkInputTrace`, and returns a
 * teardown (or a no-op). Kept out of the hot path by the early returns.
 */
export function maybeInstallDevInputTrace(textarea: HTMLTextAreaElement): () => void {
  if (!isDev) return () => {};
  try {
    if (globalThis.localStorage?.getItem("vmark:trace-input") !== "1") return () => {};
  } catch {
    return () => {};
  }
  const trace = createInputTrace();
  const detach = attachInputTrace({ textarea, trace });
  const api = {
    snapshot: trace.snapshot,
    clear: trace.clear,
    download: () => {
      const blob = new Blob([JSON.stringify(trace.snapshot(), null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vmark-input-trace.json";
      a.click();
      URL.revokeObjectURL(url);
    },
  };
  (globalThis as unknown as { __vmarkInputTrace?: typeof api }).__vmarkInputTrace = api;
  return detach;
}
