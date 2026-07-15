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
import { describe, it, expect, beforeEach, vi } from "vitest";
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
  OCCLUDER: { crash: "crash-overlay", dialog: "page-dialog", approval: "approval-dialog", error: "error-overlay" },
}));

import { ensureBrowserNativeView, useBrowserNativeView } from "./useBrowserNativeView";
import { useBrowserUiStore } from "@/stores/browserUiStore";

// jsdom has no ResizeObserver. The hook observes the reserved rect, so it needs one; the
// bounds report is driven directly (`report()` on attach), which is what these assert.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", StubResizeObserver);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  resync.mockReset();
  useBrowserUiStore.setState({ entries: {} });
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

  it("destroys the native view on unmount", async () => {
    const { unmount } = renderHook(() =>
      useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_create", expect.anything()));
    act(() => unmount());
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_destroy", { tabId: "t1" }),
    );
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

  it("does not resync a tab whose surface already unmounted", async () => {
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
    expect(resync).not.toHaveBeenCalled();
  });
});

describe("useBrowserNativeView — bounds", () => {
  it("reports the reserved rect so Rust can align the native view under it", async () => {
    renderHook(() => useBrowserNativeView("t1", "https://example.com", "v0", viewportRef()));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_set_bounds",
        expect.objectContaining({ tabId: "t1" }),
      ),
    );
  });
});
