import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PTY_RESIZE_DEBOUNCE_MS, fitAndResizePty } from "./fitAndResizePty";
import type { FitResizeTarget } from "./fitAndResizePty";

function createTarget(
  overrides: Partial<FitResizeTarget> = {},
  dims: { cols: number; rows: number } = { cols: 120, rows: 40 },
): FitResizeTarget & { resize: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn> } {
  const resize = vi.fn();
  const fit = vi.fn();
  const target = {
    instance: {
      term: dims,
      fitAddon: { fit },
    },
    pty: { resize } as unknown as FitResizeTarget["pty"],
    disposed: false,
    ...overrides,
  } as FitResizeTarget & { resize: typeof resize; fit: typeof fit };
  target.resize = resize;
  target.fit = fit;
  return target;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fitAndResizePty", () => {
  // Regression: the terminal settings-sync effect called fitAddon.fit() on a
  // font change but never pty.resize(), so the shell kept its old TIOCSWINSZ
  // dimensions — line wrapping and TUI layout corrupt until an unrelated panel
  // resize happened to fix it. fit() and resize() are one operation.
  it("fits immediately and resizes the PTY after the debounce", () => {
    const target = createTarget();

    fitAndResizePty(target);

    expect(target.fit).toHaveBeenCalledTimes(1);
    expect(target.resize).not.toHaveBeenCalled(); // deferred

    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).toHaveBeenCalledWith(120, 40);
  });

  it("debounces bursts into a single PTY resize with the final dimensions", () => {
    const target = createTarget();

    fitAndResizePty(target);
    target.instance.term.cols = 80;
    target.instance.term.rows = 24;
    fitAndResizePty(target);

    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.fit).toHaveBeenCalledTimes(2);
    expect(target.resize).toHaveBeenCalledTimes(1);
    expect(target.resize).toHaveBeenCalledWith(80, 24);
  });

  it("keeps each session's debounce independent", () => {
    // A single shared timer ref would let one session's fit cancel another's
    // pending PTY resize, leaving that shell permanently stale.
    const a = createTarget({}, { cols: 100, rows: 30 });
    const b = createTarget({}, { cols: 60, rows: 20 });

    fitAndResizePty(a);
    fitAndResizePty(b);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(a.resize).toHaveBeenCalledWith(100, 30);
    expect(b.resize).toHaveBeenCalledWith(60, 20);
  });

  it("does not resize a disposed session", () => {
    const target = createTarget();

    fitAndResizePty(target);
    target.disposed = true;
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).not.toHaveBeenCalled();
  });

  it("does not resize when the caller reports the entry is stale", () => {
    const target = createTarget();

    fitAndResizePty(target, () => true);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).not.toHaveBeenCalled();
  });

  it("skips the PTY resize when there is no PTY", () => {
    const target = createTarget({ pty: null });

    expect(() => {
      fitAndResizePty(target);
      vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);
    }).not.toThrow();
  });

  it("skips the PTY resize for zero dimensions (hidden container)", () => {
    const target = createTarget({}, { cols: 0, rows: 0 });

    fitAndResizePty(target);
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).not.toHaveBeenCalled();
  });

  it("swallows a throwing fit() and schedules no resize", () => {
    const target = createTarget();
    (target.fit as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("container not visible");
    });

    expect(() => fitAndResizePty(target)).not.toThrow();
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).not.toHaveBeenCalled();
  });

  it("cancels a previously-scheduled resize when a later fit throws", () => {
    // audit Low-15: a successful fit schedules a resize; if the next call's
    // fit() throws (container hidden), the earlier resize must be cancelled,
    // not fire with stale dimensions.
    const target = createTarget({}, { cols: 100, rows: 30 });

    fitAndResizePty(target); // schedules a resize for 100x30
    (target.fit as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("container hidden");
    });
    fitAndResizePty(target); // fit throws — must cancel the pending resize

    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS);

    expect(target.resize).not.toHaveBeenCalled();
  });

  it("swallows a PTY that exits between the fit and the debounce tick", () => {
    const target = createTarget();
    (target.resize as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("pty exited");
    });

    fitAndResizePty(target);

    expect(() => vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS)).not.toThrow();
  });
});
