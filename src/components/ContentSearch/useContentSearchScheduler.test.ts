import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import {
  useContentSearchScheduler,
  DEBOUNCE_MS,
  MIN_QUERY_LENGTH,
} from "./useContentSearchScheduler";

type Args = Parameters<typeof useContentSearchScheduler>[0];

function baseArgs(overrides: Partial<Args> = {}): Args {
  return {
    isOpen: true,
    query: "hello",
    rootPath: "/root",
    excludeFolders: ["node_modules"],
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    markdownOnly: false,
    ...overrides,
  };
}

describe("useContentSearchScheduler", () => {
  let runSpy: ReturnType<typeof vi.fn>;
  let clearSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    runSpy = vi.fn();
    clearSpy = vi.fn();
    // Replace the two store actions the hook calls so we observe scheduling
    // without exercising the real (Tauri-backed) search.
    useUIStore.setState({
      contentSearchRun: runSpy as never,
      contentSearchClearResults: clearSpy as never,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the search after the debounce window with the live exclude folders", () => {
    renderHook(() => useContentSearchScheduler(baseArgs()));

    expect(runSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(runSpy).toHaveBeenCalledExactlyOnceWith("/root", ["node_modules"]);
  });

  it("does not run until the full debounce window elapses", () => {
    renderHook(() => useContentSearchScheduler(baseArgs()));
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("clears results instead of running when the query is too short", () => {
    const shortQuery = "a".repeat(MIN_QUERY_LENGTH - 1);
    renderHook(() => useContentSearchScheduler(baseArgs({ query: shortQuery })));

    expect(clearSpy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the panel is closed", () => {
    renderHook(() => useContentSearchScheduler(baseArgs({ isOpen: false })));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(runSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("does nothing when there is no workspace root", () => {
    renderHook(() => useContentSearchScheduler(baseArgs({ rootPath: null })));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(runSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("debounces rapid query changes into a single run", () => {
    const { rerender } = renderHook(
      (args: Args) => useContentSearchScheduler(args),
      { initialProps: baseArgs({ query: "hel" }) },
    );

    rerender(baseArgs({ query: "hell" }));
    rerender(baseArgs({ query: "hello" }));

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(runSpy).toHaveBeenCalledOnce();
  });

  it("reads exclude folders at execution time, not capture time", () => {
    const { rerender } = renderHook(
      (args: Args) => useContentSearchScheduler(args),
      {
        initialProps: baseArgs({ excludeFolders: ["dist"] }),
      },
    );

    // A late exclusion change (same query) should be picked up by the running
    // timer via the ref without re-firing the effect.
    rerender(baseArgs({ excludeFolders: ["dist", "build"] }));

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(runSpy).toHaveBeenCalledExactlyOnceWith("/root", ["dist", "build"]);
  });
});
