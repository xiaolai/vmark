import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  toastMessage: vi.fn(),
  toastLoading: vi.fn(),
  toastDismiss: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    message: mocks.toastMessage,
    loading: mocks.toastLoading,
    dismiss: mocks.toastDismiss,
  },
}));

vi.mock("@/stores/activeEditorStore", () => ({
  useActiveEditorStore: {
    getState: vi.fn(() => ({
      activeWysiwygEditor: null,
      activeSourceView: null,
    })),
  },
}));

import { imeToast } from "./imeToast";
import { useActiveEditorStore } from "@/stores/activeEditorStore";

function fireCompositionEnd() {
  document.dispatchEvent(new Event("compositionend"));
}

/** Set WYSIWYG editor composing state */
function setComposing(composing: boolean) {
  vi.mocked(useActiveEditorStore.getState).mockReturnValue({
    activeWysiwygEditor: composing ? { view: { composing: true } } : null,
    activeSourceView: null,
  } as never);
}

describe("imeToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: not composing
    setComposing(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows info toast immediately when not composing", () => {
    imeToast.info("hello");
    expect(mocks.toastInfo).toHaveBeenCalledWith("hello");
  });

  it("shows success toast immediately when not composing", () => {
    imeToast.success("done");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("done");
  });

  it("defers info toast until compositionend when WYSIWYG editor is composing", () => {
    setComposing(true);

    imeToast.info("deferred");
    expect(mocks.toastInfo).not.toHaveBeenCalled();

    // Composition ends — editor stops composing, compositionend fires
    setComposing(false);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastInfo).toHaveBeenCalledWith("deferred");
  });

  it("defers success toast until compositionend when Source editor is composing", () => {
    vi.mocked(useActiveEditorStore.getState).mockReturnValue({
      activeWysiwygEditor: null,
      activeSourceView: { composing: true },
    } as never);

    imeToast.success("deferred");
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    vi.mocked(useActiveEditorStore.getState).mockReturnValue({
      activeWysiwygEditor: null,
      activeSourceView: { composing: false },
    } as never);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("deferred");
  });

  it("flushes multiple queued toasts on compositionend", () => {
    setComposing(true);

    imeToast.info("first");
    imeToast.success("second");
    expect(mocks.toastInfo).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    setComposing(false);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastInfo).toHaveBeenCalledWith("first");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("second");
  });

  it("does not flush before post-composition delay elapses", () => {
    setComposing(true);

    imeToast.info("deferred");
    setComposing(false);
    fireCompositionEnd();
    // Only 30ms — should not flush yet
    vi.advanceTimersByTime(30);
    expect(mocks.toastInfo).not.toHaveBeenCalled();

    // Remaining 30ms — now it should flush
    vi.advanceTimersByTime(30);
    expect(mocks.toastInfo).toHaveBeenCalledWith("deferred");
  });

  it("never defers error toast (urgent)", () => {
    setComposing(true);

    imeToast.error("fail");
    expect(mocks.toastError).toHaveBeenCalledWith("fail");
  });

  it("never defers warning toast (urgent)", () => {
    setComposing(true);

    imeToast.warning("warn");
    expect(mocks.toastWarning).toHaveBeenCalledWith("warn");
  });

  it("defers message toast when composing and flushes after compositionend", () => {
    setComposing(true);

    imeToast.message("Moved tab", { action: { label: "Undo", onClick: () => {} } });
    expect(mocks.toastMessage).not.toHaveBeenCalled();

    setComposing(false);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastMessage).toHaveBeenCalledWith(
      "Moved tab",
      expect.objectContaining({ action: expect.any(Object) }),
    );
  });

  it("shows message toast immediately when not composing", () => {
    imeToast.message("Moved tab");
    expect(mocks.toastMessage).toHaveBeenCalledWith("Moved tab");
  });

  it("never defers loading toast (used for in-progress state)", () => {
    setComposing(true);
    mocks.toastLoading.mockReturnValueOnce("loading-id-123");

    const id = imeToast.loading("Working…");
    expect(mocks.toastLoading).toHaveBeenCalledWith("Working…");
    // Returned id should match what sonner returned (we forward it)
    expect(id).toBe("loading-id-123");
  });

  it("dismiss passes through to sonner immediately", () => {
    setComposing(true);

    imeToast.dismiss("toast-id");
    expect(mocks.toastDismiss).toHaveBeenCalledWith("toast-id");
  });

  // ── Pin support ────────────────────────────────────────────────────────────
  describe("pin option", () => {
    it("error without { pin } passes through unchanged (preserves existing call signature)", () => {
      imeToast.error("plain error");
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      expect(mocks.toastError).toHaveBeenCalledWith("plain error");
    });

    it("error with { pin: true } adds an action with pin label and stable id", () => {
      imeToast.error("long error", { pin: true });
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      const [msg, opts] = mocks.toastError.mock.calls[0];
      expect(msg).toBe("long error");
      expect(opts).toBeDefined();
      expect(opts.id).toEqual(expect.any(String));
      expect(opts.action).toBeDefined();
      expect(opts.action.onClick).toEqual(expect.any(Function));
      // Pin field is consumed — never leaked to sonner.
      expect(opts.pin).toBeUndefined();
    });

    it("warning with { pin: true } also gets a pin action", () => {
      imeToast.warning("long warning", { pin: true });
      const [, opts] = mocks.toastWarning.mock.calls[0];
      expect(opts?.action?.onClick).toEqual(expect.any(Function));
    });

    it("respects user-provided action — does not override with pin", () => {
      const userAction = { label: "Undo", onClick: vi.fn() };
      imeToast.error("err", { pin: true, action: userAction });
      const [, opts] = mocks.toastError.mock.calls[0];
      expect(opts.action).toBe(userAction);
    });

    it("clicking the pin action re-fires the toast with duration: Infinity and same id", () => {
      imeToast.error("pinnable", { pin: true });
      const [, firstOpts] = mocks.toastError.mock.calls[0];
      const firstId = firstOpts.id;
      const fakeEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent;

      mocks.toastError.mockClear();
      firstOpts.action.onClick(fakeEvent);

      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      const [msg, opts] = mocks.toastError.mock.calls[0];
      expect(msg).toBe("pinnable");
      expect(opts.id).toBe(firstId); // sonner replaces the toast in place
      expect(opts.duration).toBe(Number.POSITIVE_INFINITY);
    });

    it("info also supports { pin: true }", () => {
      imeToast.info("info with pin", { pin: true });
      const [, opts] = mocks.toastInfo.mock.calls[0];
      expect(opts?.action?.onClick).toEqual(expect.any(Function));
    });

    it("preserves user-supplied id when pinning", () => {
      imeToast.error("err", { pin: true, id: "my-fixed-id" });
      const [, opts] = mocks.toastError.mock.calls[0];
      expect(opts.id).toBe("my-fixed-id");
    });

    it("preserves numeric ids on pin click — does not coerce to string", () => {
      // Sonner treats string/number ids as distinct namespaces; coercing
      // would create a new toast instead of replacing the pinned one.
      imeToast.error("err", { pin: true, id: 42 });
      const [, opts] = mocks.toastError.mock.calls[0];
      expect(opts.id).toBe(42);

      const fakeEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent;
      mocks.toastError.mockClear();
      opts.action.onClick(fakeEvent);

      const [, newOpts] = mocks.toastError.mock.calls[0];
      expect(newOpts.id).toBe(42);
      expect(typeof newOpts.id).toBe("number");
    });
  });

  it("re-defers if composition restarts before flush", () => {
    setComposing(true);

    imeToast.info("deferred");
    expect(mocks.toastInfo).not.toHaveBeenCalled();

    // compositionend fires but editor immediately starts composing again
    fireCompositionEnd();
    // Still composing when flush runs after 60ms (re-check sees composing=true)
    vi.advanceTimersByTime(60);
    // Should NOT have flushed — still composing
    expect(mocks.toastInfo).not.toHaveBeenCalled();

    // Now composition truly ends
    setComposing(false);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastInfo).toHaveBeenCalledWith("deferred");
  });

  it("force-flushes after fallback timeout if compositionend never fires", () => {
    setComposing(true);

    imeToast.info("stuck");
    expect(mocks.toastInfo).not.toHaveBeenCalled();

    // Advance past fallback timeout (5000ms) — flushes regardless
    vi.advanceTimersByTime(5000);
    expect(mocks.toastInfo).toHaveBeenCalledWith("stuck");
  });

  it("clearFallbackTimer is a no-op when timer is already null (normal flush path)", () => {
    // Normal path: compositionend fires, no fallback timer running
    setComposing(true);
    imeToast.info("test");
    // Cancel fallback timer by advancing past it first (so it fires and clears itself)
    // then compositionend also fires — clearFallbackTimer is called with null timer
    setComposing(false);
    // Fire compositionend immediately so fallback hasn't run yet — but timer IS set
    // We need to clear it: advance just past POST_COMPOSITION_DELAY after compositionend
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    // Toast flushed, fallbackTimer was cleared (it was non-null so the !null branch ran)
    expect(mocks.toastInfo).toHaveBeenCalledWith("test");
  });

  it("skips re-attaching compositionend listener when it is already attached", () => {
    // Queue two toasts back-to-back while composing, then compositionend fires
    // but isEditorComposing() is still true (rapid re-composition).
    // flushPendingToasts sees composing=true. The first call attaches the listener.
    // The second queued toast triggers deferIfComposing again while listener already attached.
    setComposing(true);
    imeToast.info("first");
    // Listener is now attached. Simulate compositionend firing (listener consumed)
    // but still composing — flushPendingToasts tries to re-attach, succeeds
    fireCompositionEnd();
    // Still composing — flush re-defers
    vi.advanceTimersByTime(60);
    // Now queue another toast (listener already attached from re-defer)
    imeToast.info("second");
    // Composition ends for real
    setComposing(false);
    fireCompositionEnd();
    vi.advanceTimersByTime(60);
    expect(mocks.toastInfo).toHaveBeenCalledWith("first");
    expect(mocks.toastInfo).toHaveBeenCalledWith("second");
  });
});
