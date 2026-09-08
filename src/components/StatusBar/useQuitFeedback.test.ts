// WI-FL5.8 — useQuitFeedback: the "Press Cmd+Q again to quit" hint follows
// Rust's confirm-quit window (ledger F7, status-bar / quit). The hook only
// SHOWS the window; Rust decides whether the second press quits. So the hint
// must stay up for exactly the Rust window after the FIRST press, and re-arm
// for a press after it.
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuitFeedback } from "./useQuitFeedback";

const bridge = vi.hoisted(() => ({
  handler: null as (() => void) | null,
  unlisten: vi.fn(),
  listenCalls: [] as string[],
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: (event: string, handler: () => void) => {
      bridge.listenCalls.push(event);
      bridge.handler = handler;
      return Promise.resolve(bridge.unlisten);
    },
  }),
}));

/** Rust's CONFIRM_QUIT_WINDOW, read from the source so the two cannot drift.
 *  Repo-relative, like menuRouting.test.ts: under jsdom `import.meta.url` is
 *  not a file: URL. */
function rustConfirmQuitWindowMs(): number {
  const source = readFileSync("src-tauri/src/quit.rs", "utf8");
  const match = /const CONFIRM_QUIT_WINDOW: Duration = Duration::from_secs\((\d+)\);/.exec(source);
  if (!match) throw new Error("CONFIRM_QUIT_WINDOW not found in quit.rs — the hook's window has nothing to match");
  return Number(match[1]) * 1000;
}

const WINDOW_MS = rustConfirmQuitWindowMs();

function firstPress() {
  act(() => {
    bridge.handler?.();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  bridge.handler = null;
  bridge.listenCalls = [];
  bridge.unlisten.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQuitFeedback", () => {
  it("listens for the first-press event on THIS window and starts hidden", () => {
    const { result } = renderHook(() => useQuitFeedback());
    expect(result.current).toBe(false);
    expect(bridge.listenCalls).toEqual(["app:quit-first-press"]);
  });

  it("a first press shows the hint for exactly the Rust confirm-quit window", () => {
    const { result } = renderHook(() => useQuitFeedback());

    firstPress();
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(WINDOW_MS - 1));
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("the window is measured from the FIRST press — a press inside it does not extend the hint (Rust quits on that one)", () => {
    const { result } = renderHook(() => useQuitFeedback());

    firstPress();
    act(() => vi.advanceTimersByTime(WINDOW_MS / 2));
    firstPress(); // Rust would already be quitting; if not, the hint must not stretch
    act(() => vi.advanceTimersByTime(WINDOW_MS / 2));

    expect(result.current).toBe(false);
  });

  it("a press AFTER the window re-arms: the hint shows again and runs a fresh window", () => {
    const { result } = renderHook(() => useQuitFeedback());

    firstPress();
    act(() => vi.advanceTimersByTime(WINDOW_MS));
    expect(result.current).toBe(false);

    firstPress();
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(WINDOW_MS - 1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("unmounting stops listening and leaves no timer to flip state on a dead component", async () => {
    const { result, unmount } = renderHook(() => useQuitFeedback());
    firstPress();
    expect(result.current).toBe(true);

    unmount();
    await act(async () => {
      await Promise.resolve(); // let safeUnlistenAsync reach the resolved unlisten
    });

    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
