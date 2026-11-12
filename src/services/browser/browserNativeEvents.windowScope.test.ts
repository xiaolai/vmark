// @vitest-environment node
/**
 * One window's browser events must not reach another window's hub.
 *
 * Rust sends every `browser://*` event with `emit_to_owner`, i.e. addressed to the
 * ONE window that owns the tab. Tauri delivers an addressed event to every JS
 * listener whose target is `Any` OR matches the address, across all webviews
 * (`tauri-2.x/src/event/listener.rs`, `match_any_or_filter`). A hub that registers
 * with the global `listen()` has target `Any`, so every window's hub was woken by
 * every other window's tab events and cached them (same class as #1672).
 *
 * The bus below implements that delivery rule, with two simulated windows. The hub
 * is window-scoped through `getCurrentWebviewWindow()` — the webview the code runs
 * in, which cannot disagree with the label Rust resolves from `webview.label()`.
 *
 * @module services/browser/browserNativeEvents.windowScope.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Target = { kind: "Any" } | { kind: "WebviewWindow"; label: string };
type Handler = (event: { payload: unknown }) => void;
interface Registered {
  id: number;
  event: string;
  target: Target;
  handler: Handler;
}

const bus = vi.hoisted(() => ({
  listeners: [] as Registered[],
  nextId: 0,
  /** Label of the webview whose code is "running" (set before it subscribes). */
  current: "A",
  /** Fails the next N registrations (to exercise the retry path). */
  failNext: 0,
  /** Registrations an emitted event was delivered to (before any payload decoding). */
  reached: [] as Registered[],
}));

vi.mock("@/utils/debug", () => ({ browserWarn: vi.fn() }));

function register(event: string, handler: Handler, target: Target) {
  if (bus.failNext > 0) {
    bus.failNext -= 1;
    return Promise.reject(new Error("ipc not ready"));
  }
  const entry = { id: bus.nextId++, event, target, handler };
  bus.listeners.push(entry);
  return Promise.resolve(() => {
    bus.listeners = bus.listeners.filter((l) => l.id !== entry.id);
  });
}

vi.mock("@tauri-apps/api/event", () => ({
  /** Global `listen`: no target means `Any`. */
  listen: (event: string, handler: Handler) => register(event, handler, { kind: "Any" }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    const label = bus.current;
    return {
      label,
      listen: (event: string, handler: Handler) =>
        register(event, handler, { kind: "WebviewWindow", label }),
    };
  },
}));

/** `app.emit_to(label, …)`, filtered as Tauri does. */
function emitTo(label: string, event: string, payload: unknown) {
  for (const l of [...bus.listeners]) {
    if (l.event !== event) continue;
    if (l.target.kind === "Any" || l.target.label === label) {
      bus.reached.push(l);
      l.handler({ payload });
    }
  }
}

import { BROWSER_NATIVE_EVENTS } from "./browserNativeEventDecoder";
import { BrowserNativeEventHub } from "./browserNativeEvents";

const nav = (tabId: string) => ({ tabId, url: "https://a.example/", generation: 1, navigationId: `n-${tabId}` });

/** Subscribe a fresh hub as if its code ran in window `label`. */
async function hubIn(label: string) {
  bus.current = label;
  const hub = new BrowserNativeEventHub();
  const handler = vi.fn();
  const sub = hub.subscribe(handler);
  await sub.ready;
  return { hub, handler, sub };
}

beforeEach(() => {
  bus.listeners = [];
  bus.nextId = 0;
  bus.current = "A";
  bus.failNext = 0;
  bus.reached = [];
});
afterEach(() => vi.useRealTimers());

describe("BrowserNativeEventHub — window scope", () => {
  it("an event addressed to window A reaches A's hub and not B's", async () => {
    const a = await hubIn("A");
    const b = await hubIn("B");
    emitTo("A", "browser://navigated", nav("tab-a"));
    expect(a.handler).toHaveBeenCalledTimes(1);
    expect(b.handler).not.toHaveBeenCalled();
    a.sub.unsubscribe();
    b.sub.unsubscribe();
  });

  it("every native event is scoped, not just one", async () => {
    const a = await hubIn("A");
    const b = await hubIn("B");
    // Judged at delivery, so a payload the decoder would drop cannot hide a leak.
    for (const event of BROWSER_NATIVE_EVENTS) {
      bus.reached = [];
      emitTo("B", event, { tabId: "t" });
      expect(bus.reached, event).toHaveLength(1);
      expect(bus.reached[0].target).toEqual({ kind: "WebviewWindow", label: "B" });
    }
    expect(a.handler).not.toHaveBeenCalled();
    a.sub.unsubscribe();
    b.sub.unsubscribe();
  });

  it("a window created later hears only its own events", async () => {
    const a = await hubIn("A");
    emitTo("A", "browser://navigated", nav("t1"));
    const late = await hubIn("doc-2");
    emitTo("A", "browser://navigated", nav("t2"));
    emitTo("doc-2", "browser://navigated", nav("t3"));
    expect(a.handler).toHaveBeenCalledTimes(2);
    expect(late.handler).toHaveBeenCalledTimes(1);
    a.sub.unsubscribe();
    late.sub.unsubscribe();
  });

  it("a tab re-created in another window is heard by the new owner only", async () => {
    const a = await hubIn("A");
    const b = await hubIn("B");
    emitTo("A", "browser://navigated", nav("tab-1"));
    emitTo("B", "browser://navigated", nav("tab-1")); // same tab id, now owned by B
    expect(a.handler).toHaveBeenCalledTimes(1);
    expect(b.handler).toHaveBeenCalledTimes(1);
    a.sub.unsubscribe();
    b.sub.unsubscribe();
  });

  it("rapid subscribe/unsubscribe leaves no registration behind", async () => {
    bus.current = "A";
    const hub = new BrowserNativeEventHub();
    for (let i = 0; i < 5; i++) hub.subscribe(() => {}).unsubscribe();
    const last = hub.subscribe(() => {});
    await last.ready;
    await Promise.resolve();
    expect(bus.listeners).toHaveLength(BROWSER_NATIVE_EVENTS.length);
    expect(bus.listeners.every((l) => l.target.kind === "WebviewWindow")).toBe(true);
    last.unsubscribe();
    expect(bus.listeners).toHaveLength(0);
  });

  it("a retried registration is still scoped to the window", async () => {
    vi.useFakeTimers();
    bus.current = "A";
    bus.failNext = 2;
    const hub = new BrowserNativeEventHub();
    const handler = vi.fn();
    const sub = hub.subscribe(handler);
    await vi.runAllTimersAsync();
    await sub.ready;
    expect(bus.listeners.every((l) => l.target.kind === "WebviewWindow" && l.target.label === "A")).toBe(true);
    bus.current = "B"; // a later window must not matter to A's retries
    emitTo("B", "browser://navigated", nav("t"));
    expect(handler).not.toHaveBeenCalled();
    emitTo("A", "browser://navigated", nav("t"));
    expect(handler).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it("a missing webview (no Tauri internals) is a failed registration, not a throw", async () => {
    vi.useFakeTimers();
    bus.current = "A";
    const mod = await import("@tauri-apps/api/webviewWindow");
    const spy = vi.spyOn(mod, "getCurrentWebviewWindow").mockImplementation(() => {
      throw new Error("no __TAURI_INTERNALS__");
    });
    const hub = new BrowserNativeEventHub();
    const sub = hub.subscribe(() => {});
    const settled = expect(sub.ready).rejects.toThrow("no __TAURI_INTERNALS__");
    await vi.runAllTimersAsync();
    await settled;
    spy.mockRestore();
  });
});
