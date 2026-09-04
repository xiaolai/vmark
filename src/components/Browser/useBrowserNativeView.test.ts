// WI-1.3 / WI-S0.10 — the native view's lifecycle, split out of BrowserSurface.
// WI-S0.11 — occlusion is re-driven once the native view EXISTS.
//
// The last one is an audit-verification finding (#4). The surface seeds its
// `browserUiStore` entry before it invokes `browser_create`, and `useBrowserOccluder`
// watches that store — so an overlay that is already up (the command palette is *how* you
// open a browser tab) freezes a tab whose native view does not exist yet. Rust refuses it,
// correctly. Nothing then retried, because the controller only reconciles when an occluder
// is added or removed, and none was. The view finished creating and came up LIVE on top of
// the overlay: precisely the failure occlusion exists to prevent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const invoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const resync = vi.fn();
vi.mock("@/services/browser/browserOcclusion", () => ({
  browserOcclusion: {
    resync: (...a: unknown[]) => resync(...a),
    removeTab: vi.fn(),
    addOccluder: vi.fn(),
    removeOccluder: vi.fn(),
    isFrozen: () => false,
  },
  OCCLUDER: {
    crash: "crash-overlay",
    dialog: "page-dialog",
    approval: "approval-dialog",
    error: "error-overlay",
    background: "background-tab",
  },
}));

import { useBrowserNativeView } from "./useBrowserNativeView";
import { __resetNativeViews, destroyBrowserNativeView, ensureBrowserNativeView, hasBrowserNativeView } from "@/services/browser/browserNativeViews";
import { browserOcclusion } from "@/services/browser/browserOcclusion";
import { useBrowserUiStore } from "@/stores/browserUiStore";

// jsdom has no ResizeObserver. The hook observes the reserved rect, so it needs one; the
// bounds report is driven directly (`report()` on attach) and, for the coalescing tests,
// through the captured callback.
let resizeCb: ResizeObserverCallback | null = null;
class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    resizeCb = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

beforeEach(() => {
  // The hook retries a rejected bounds report on a timer; the clock is controlled so
  // that timer cannot fire between a mock reset and an assertion.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  invoke.mockReset().mockResolvedValue(undefined);
  resync.mockReset();
  // Native-view records now outlive a surface (audit L-01), so tests reset them.
  __resetNativeViews();
  useBrowserUiStore.setState({ entries: {} });
  resizeCb = null;
});

afterEach(() => {
  vi.useRealTimers();
});

/** The rect the surface reserves; the hook reports it so Rust can align the native view. */
function viewportRef() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return { current: el };
}

describe("useBrowserNativeView — create/destroy", () => {
  it("creates the native view for the tab and seeds the omnibox entry", async () => {
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_create", {
        tabId: "t1",
        url: "https://example.com",
      }),
    );
    expect(useBrowserUiStore.getState().entries.t1?.urlInput).toBe("https://example.com");
  });

  it("records the failure when create rejects — a tab with no view is not an empty rect", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create" ? Promise.reject(new Error("no window")) : Promise.resolve(),
    );
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    await waitFor(() =>
      expect(useBrowserUiStore.getState().entries.t1?.error).toBe("no window"),
    );
  });

  // WI-14 — a typed CommandError is a plain object, so the old
  // `errorMessage(e)` printed the literal text "[object Object]" into the
  // browser chrome.
  it("shows a typed rejection's message, not [object Object]", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_ai_create"
        ? Promise.reject({
            code: "permission-denied",
            message: "AI navigation to this destination is blocked by policy",
            detail: { mcpCode: "SSRF_BLOCKED" },
          })
        : Promise.resolve(),
    );
    renderHook(() =>
      useBrowserNativeView("t1", "https://example.com", "v0", viewportRef(), "ai-sandbox"),
    );
    await waitFor(() =>
      expect(useBrowserUiStore.getState().entries.t1?.error).toBe(
        "AI navigation to this destination is blocked by policy",
      ),
    );
  });

  it("leaves the tab clean when the create is only awaiting approval", async () => {
    // The approval prompt owns this interaction and the MCP handler retries
    // after the user decides. Painting a persistent error underneath it showed
    // the raw protocol token "APPROVAL_REQUIRED" in the chrome at the same time.
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_ai_create"
        ? Promise.reject({
            code: "approval-required",
            message: "This page needs your approval before the AI can open it",
          })
        : Promise.resolve(),
    );
    renderHook(() =>
      useBrowserNativeView("t2", "https://example.com", "v0", viewportRef(), "ai-shared"),
    );
    await waitFor(() => expect(useBrowserUiStore.getState().entries.t2?.loading).toBe(false));
    expect(useBrowserUiStore.getState().entries.t2?.error).toBeNull();
  });

  it("shares an AI create promise when the hook and MCP open race", async () => {
    let resolveCreate!: () => void;
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_ai_create"
        ? new Promise<void>((resolve) => {
            resolveCreate = resolve;
          })
        : Promise.resolve(),
    );
    const first = ensureBrowserNativeView("ai-1", "https://example.com", "ai-sandbox");
    const second = ensureBrowserNativeView("ai-1", "https://example.com", "ai-sandbox");
    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolveCreate();
    await expect(first).resolves.toBeUndefined();
  });

  it("allows a fresh AI create after approval rejection and clears the old error", async () => {
    invoke
      .mockRejectedValueOnce(new Error("APPROVAL_REQUIRED"))
      .mockResolvedValueOnce(undefined);
    useBrowserUiStore.getState().ensureEntry("ai-2", "https://example.com");
    useBrowserUiStore.getState().setError("ai-2", "APPROVAL_REQUIRED");

    await expect(
      ensureBrowserNativeView("ai-2", "https://example.com", "ai-shared"),
    ).rejects.toThrow("APPROVAL_REQUIRED");
    await expect(
      ensureBrowserNativeView("ai-2", "https://example.com", "ai-shared"),
    ).resolves.toBeUndefined();
    expect(useBrowserUiStore.getState().entries["ai-2"]?.error).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  // Audit 2026-09-03 L-01 — unmount HIDES (background occluder); the tab keeps its page.
  it("hides the native view on unmount instead of destroying it, and shows it on remount", async () => {
    const { unmount } = renderHook(() =>
      useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    act(() => unmount());
    expect(browserOcclusion.addOccluder).toHaveBeenCalledWith("t1", "background-tab");
    expect(invoke).not.toHaveBeenCalledWith("browser_destroy", expect.anything());
    expect(hasBrowserNativeView("t1")).toBe(true);

    invoke.mockClear();
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    expect(browserOcclusion.removeOccluder).toHaveBeenCalledWith("t1", "background-tab");
    await Promise.resolve();
    // One view, created once: no second browser_create.
    expect(invoke).not.toHaveBeenCalledWith("browser_create", expect.anything());
  });

  it("destroyBrowserNativeView waits for a create in flight, tears down, and forgets the tab", async () => {
    let settle: (() => void) | undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create"
        ? new Promise<void>((r) => {
            settle = r;
          })
        : Promise.resolve(undefined),
    );
    void ensureBrowserNativeView("t1", "https://example.com", "human");
    const destroyed = destroyBrowserNativeView("t1");
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalledWith("browser_destroy", expect.anything());
    settle?.();
    await destroyed;
    expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId: "t1" });
    expect(hasBrowserNativeView("t1")).toBe(false);
    expect(browserOcclusion.removeTab).toHaveBeenCalledWith("t1");
    // Idempotent: a second destroy is harmless.
    await destroyBrowserNativeView("t1");
  });
});

describe("useBrowserNativeView — occlusion is enforced against the view that exists", () => {
  it("resyncs occlusion once create resolves (a freeze raised before the view existed)", async () => {
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    // Not at seed time — there is nothing to freeze yet — but once the view is real.
    await waitFor(() => expect(resync).toHaveBeenCalledWith("t1"));
  });

  it("does NOT resync when create failed — there is no view to freeze", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    await waitFor(() =>
      expect(useBrowserUiStore.getState().entries.t1?.error).toBe("boom"),
    );
    expect(resync).not.toHaveBeenCalled();
  });

  // Audit 2026-09-03 L-01: the view outlives the surface, so a create that settles
  // AFTER unmount produces a live view that must be HIDDEN — the background occluder
  // is added and the controller re-driven, rather than nothing happening.
  it("a create that settles after unmount hides the new view under the background occluder", async () => {
    let settle: (() => void) | undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create"
        ? new Promise<void>((r) => {
            settle = r;
          })
        : Promise.resolve(),
    );
    const { unmount } = renderHook(() =>
      useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()),
    );
    act(() => unmount());
    await act(async () => {
      settle?.();
    });
    expect(browserOcclusion.addOccluder).toHaveBeenCalledWith("t1", "background-tab");
    expect(resync).toHaveBeenCalledWith("t1");
    expect(hasBrowserNativeView("t1")).toBe(true);
  });
});

describe("useBrowserNativeView — bounds", () => {
  const rect = (width: number) => ({ x: 0, y: 0, width, height: 100 }) as DOMRect;
  const boundsCalls = () => invoke.mock.calls.filter((c) => c[0] === "browser_set_bounds");

  it("reports the reserved rect so Rust can align the native view under it", async () => {
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_set_bounds",
        expect.objectContaining({ tabId: "t1" }),
      ),
    );
  });

  // Audit 2026-09-03 round 3, #167 — bounds are a serialized, latest-wins channel.
  it("coalesces rapid rects: one send in flight at a time, and only the latest is sent", async () => {
    const rects = [rect(100), rect(200), rect(300)];
    let i = 0;
    const ref = viewportRef();
    ref.current.getBoundingClientRect = () => rects[Math.min(i++, rects.length - 1)];
    let release!: () => void;
    invoke.mockImplementation((cmd: string) => {
      if (cmd !== "browser_set_bounds") return Promise.resolve();
      return boundsCalls().length === 1
        ? new Promise<void>((r) => {
            release = r;
          })
        : Promise.resolve();
    });
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", ref));
    await waitFor(() => expect(boundsCalls()).toHaveLength(1));
    expect(boundsCalls()[0][1]).toMatchObject({ width: 100 });

    // Two reflows while the first send is still in flight.
    act(() => {
      resizeCb?.([], {} as ResizeObserver);
      resizeCb?.([], {} as ResizeObserver);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(boundsCalls()).toHaveLength(1); // nothing overlaps the in-flight send

    release();
    await waitFor(() => expect(boundsCalls()).toHaveLength(2));
    expect(boundsCalls()[1][1]).toMatchObject({ width: 300 }); // latest wins; 200 is never sent
    await act(async () => {
      await Promise.resolve();
    });
    expect(boundsCalls()).toHaveLength(2);
  });

  it("holds bounds reported before the view exists, and delivers the latest once creation settles", async () => {
    let settleCreate!: () => void;
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_create"
        ? new Promise<void>((r) => {
            settleCreate = r;
          })
        : Promise.resolve(),
    );
    const rects = [rect(100), rect(200)];
    let i = 0;
    const ref = viewportRef();
    ref.current.getBoundingClientRect = () => rects[Math.min(i++, rects.length - 1)];
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", ref));
    act(() => resizeCb?.([], {} as ResizeObserver)); // a reflow while the create is pending
    // Time passes; no send and therefore no retry budget is spent against a view that
    // does not exist yet.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boundsCalls()).toHaveLength(0);

    await act(async () => {
      settleCreate();
    });
    await waitFor(() => expect(boundsCalls()).toHaveLength(1));
    expect(boundsCalls()[0][1]).toMatchObject({ tabId: "t1", width: 200 });
  });

  it("retries a refused report with backoff while mounted, and stops on unmount", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "browser_set_bounds" ? Promise.reject(new Error("no view yet")) : Promise.resolve(),
    );
    const { unmount } = renderHook(() =>
      useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()),
    );
    await waitFor(() => expect(boundsCalls().length).toBeGreaterThanOrEqual(1));
    // Backoff 100 ms, then 200 ms: the old fixed three-attempt budget is gone.
    await vi.advanceTimersByTimeAsync(100);
    await waitFor(() => expect(boundsCalls().length).toBeGreaterThanOrEqual(2));
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(boundsCalls().length).toBeGreaterThanOrEqual(3));

    act(() => unmount());
    await act(async () => {
      await Promise.resolve();
    });
    const atUnmount = boundsCalls().length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(boundsCalls().length).toBe(atUnmount);
  });
});
