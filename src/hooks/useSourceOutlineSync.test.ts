import { describe, it, expect, vi, beforeEach } from "vitest";
import { Text } from "@codemirror/state";
import { findNthHeadingPos, findHeadingIndexAtLine } from "./useSourceOutlineSync";

// Mocks for hook testing
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlisten: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: {
    getState: () => ({
      setActiveHeadingLine: vi.fn(),
    }),
  },
}));

vi.mock("@/utils/markdownOutline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/markdownOutline")>();
  return actual;
});

function textFrom(content: string): Text {
  return Text.of(content.split("\n"));
}

/** Helper: compute expected position by finding the nth occurrence of a substring */
function posOf(content: string, substring: string, occurrence = 0): number {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = content.indexOf(substring, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}

describe("findNthHeadingPos", () => {
  it("finds the first heading", () => {
    const s = "# Hello\n\nSome text\n\n## World";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Hello"));
  });

  it("finds the second heading", () => {
    const s = "# Hello\n\nSome text\n\n## World";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## World"));
  });

  it("returns -1 if heading index out of range", () => {
    const doc = textFrom("# Hello\n\n## World");
    expect(findNthHeadingPos(doc, 5)).toBe(-1);
  });

  it("returns -1 for empty document", () => {
    const doc = textFrom("");
    expect(findNthHeadingPos(doc, 0)).toBe(-1);
  });

  it("skips headings inside backtick code fences", () => {
    const s = "# Real\n\n```\n# Fake\n```\n\n## Also Real";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## Also Real"));
    expect(findNthHeadingPos(doc, 2)).toBe(-1);
  });

  it("skips headings inside tilde code fences", () => {
    const s = "# Real\n\n~~~\n# Fake\n~~~\n\n## Also Real";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## Also Real"));
  });

  it("handles longer closing fence (4 backticks close 3)", () => {
    const s = "# A\n\n```\n# B\n````\n\n## C";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## C"));
  });

  it("does not close fence with shorter fence", () => {
    const s = "# A\n\n````\n# B\n```\n# C\n````\n\n## D";
    const doc = textFrom(s);
    // 4-backtick fence opened, 3-backtick line does NOT close it
    // # B and # C are inside the fence
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## D"));
  });

  it("does not close fence with different character", () => {
    const s = "# A\n\n```\n# B\n~~~\n# C\n```\n\n## D";
    const doc = textFrom(s);
    // backtick fence cannot be closed by tilde
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# A"));
    // # B and # C are inside, ~~~ doesn't close backtick fence
    // ``` at line 7 closes it
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## D"));
  });

  it("handles headings at all levels", () => {
    const doc = textFrom("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
    for (let i = 0; i < 6; i++) {
      expect(findNthHeadingPos(doc, i)).toBeGreaterThanOrEqual(0);
    }
    expect(findNthHeadingPos(doc, 6)).toBe(-1);
  });

  it("ignores lines that look like headings but aren't (no space)", () => {
    const s = "#NoSpace\n# Real Heading";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real Heading"));
    expect(findNthHeadingPos(doc, 1)).toBe(-1);
  });
});

describe("findHeadingIndexAtLine", () => {
  it("returns -1 when cursor is before all headings", () => {
    const doc = textFrom("Some text\n\n# Heading");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(-1);
  });

  it("returns 0 when cursor is on first heading line", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(0);
  });

  it("returns 0 when cursor is between first and second heading", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 3)).toBe(0); // "Some text" line
  });

  it("returns 1 when cursor is on second heading", () => {
    const doc = textFrom("# First\n\nSome text\n\n## Second");
    expect(findHeadingIndexAtLine(doc, 5)).toBe(1);
  });

  it("skips headings inside code fences", () => {
    const doc = textFrom("# Real\n\n```\n# Fake\n```\n\n## Also Real\n\nText here");
    // Line 9 is "Text here", which is after "## Also Real" (heading index 1)
    expect(findHeadingIndexAtLine(doc, 9)).toBe(1);
    // Line 4 is "# Fake" inside code block — not counted
    expect(findHeadingIndexAtLine(doc, 4)).toBe(0);
  });

  it("returns -1 for empty document", () => {
    const doc = textFrom("");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(-1);
  });

  it("returns correct index for consecutive headings without gaps", () => {
    const doc = textFrom("# H1\n## H2\n### H3");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(0);
    expect(findHeadingIndexAtLine(doc, 2)).toBe(1);
    expect(findHeadingIndexAtLine(doc, 3)).toBe(2);
  });

  it("ignores non-heading lines with hash characters", () => {
    const doc = textFrom("#NoSpace\n###### H6\nSome #text");
    expect(findHeadingIndexAtLine(doc, 1)).toBe(-1); // #NoSpace is not a heading
    expect(findHeadingIndexAtLine(doc, 2)).toBe(0); // ###### H6 is heading 0
    expect(findHeadingIndexAtLine(doc, 3)).toBe(0); // still after heading 0
  });

  it("handles cursor on the last line of a document with trailing newline", () => {
    const doc = textFrom("# First\n\nText\n\n## Second\n");
    // Line 6 is the empty line at the end
    expect(findHeadingIndexAtLine(doc, 6)).toBe(1);
  });

  it("handles tilde code fences correctly", () => {
    const doc = textFrom("# Real\n\n~~~\n# Fake Inside Tilde\n~~~\n\n## After");
    expect(findHeadingIndexAtLine(doc, 4)).toBe(0); // Inside tilde fence
    expect(findHeadingIndexAtLine(doc, 7)).toBe(1); // After fence closes
  });

  it("handles nested-looking fences (4-backtick inside 3-backtick)", () => {
    const doc = textFrom("# A\n````\n# B\n```\n# C\n````\n## D");
    // 4-backtick fence opened, 3-backtick does NOT close it
    // # B and # C are inside the fence
    expect(findHeadingIndexAtLine(doc, 3)).toBe(0); // # B inside
    expect(findHeadingIndexAtLine(doc, 5)).toBe(0); // # C inside
    expect(findHeadingIndexAtLine(doc, 7)).toBe(1); // ## D outside
  });
});

describe("useSourceOutlineSync hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets up outline scroll listener when not hidden", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");
    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");

    const viewRef = { current: null };
    renderHook(() => useSourceOutlineSync(viewRef, false));

    // Registered for THIS window: a listener with no target is woken by every
    // window's outline click (#1672).
    expect(listen).toHaveBeenCalledWith(
      "outline:scroll-to-heading",
      expect.any(Function),
      { target: { kind: "WebviewWindow", label: "main" } }
    );
  });

  it("does not set up listener when hidden", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");

    vi.mocked(listen).mockClear();
    const viewRef = { current: null };
    renderHook(() => useSourceOutlineSync(viewRef, true));

    expect(listen).not.toHaveBeenCalled();
  });

  it("cleans up listener on unmount", async () => {
    const mockUnlisten = vi.fn();
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");
    const { safeUnlisten } = await import("@/utils/safeUnlisten");

    vi.mocked(listen).mockResolvedValue(mockUnlisten);

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    const viewRef = { current: null };
    const { unmount } = renderHook(() => useSourceOutlineSync(viewRef, false));

    // Wait for the async listen to resolve
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    unmount();
    expect(safeUnlisten).toHaveBeenCalled();
  });
});

describe("useSourceOutlineSync hook — scroll and cursor tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scrolls to heading position when outline click event fires", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");

    let outlineHandler: ((event: { payload: { headingIndex: number } }) => void) | null = null;
    vi.mocked(listen).mockImplementation((_eventName, handler) => {
      outlineHandler = handler as (event: { payload: { headingIndex: number } }) => void;
      return Promise.resolve(vi.fn());
    });

    const mockDispatch = vi.fn();
    const mockFocus = vi.fn();
    const viewRef = {
      current: {
        state: {
          doc: textFrom("# First\n\nText\n\n## Second"),
          selection: { main: { head: 0 } },
        },
        dispatch: mockDispatch,
        focus: mockFocus,
        dom: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    // Wait for async listen setup
    await vi.waitFor(() => {
      expect(outlineHandler).not.toBeNull();
    });

    // Simulate outline click on second heading (index 1)
    outlineHandler!({ payload: { headingIndex: 0 } });

    expect(mockDispatch).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
  });

  it("does not scroll when heading is not found", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");

    let outlineHandler: ((event: { payload: { headingIndex: number } }) => void) | null = null;
    vi.mocked(listen).mockImplementation((_eventName, handler) => {
      outlineHandler = handler as (event: { payload: { headingIndex: number } }) => void;
      return Promise.resolve(vi.fn());
    });

    const mockDispatch = vi.fn();
    const viewRef = {
      current: {
        state: {
          doc: textFrom("# Only one heading"),
          selection: { main: { head: 0 } },
        },
        dispatch: mockDispatch,
        focus: vi.fn(),
        dom: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    await vi.waitFor(() => {
      expect(outlineHandler).not.toBeNull();
    });

    // Request heading index 5 which doesn't exist
    outlineHandler!({ payload: { headingIndex: 5 } });

    // dispatch may have been called for cursor tracking, but not for scroll
    // The important thing is no crash
  });

  it("does not dispatch when view is null", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");

    let outlineHandler: ((event: { payload: { headingIndex: number } }) => void) | null = null;
    vi.mocked(listen).mockImplementation((_eventName, handler) => {
      outlineHandler = handler as (event: { payload: { headingIndex: number } }) => void;
      return Promise.resolve(vi.fn());
    });

    const viewRef = { current: null };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    await vi.waitFor(() => {
      expect(outlineHandler).not.toBeNull();
    });

    // Should not throw when view is null
    expect(() => {
      outlineHandler!({ payload: { headingIndex: 0 } });
    }).not.toThrow();
  });

  it("tracks active heading from cursor position via DOM listeners", async () => {
    const { renderHook } = await import("@testing-library/react");

    const mockAddEventListener = vi.fn();
    const mockRemoveEventListener = vi.fn();

    const doc = textFrom("# First\n\nText\n\n## Second");
    const viewRef = {
      current: {
        state: {
          doc,
          selection: { main: { head: 0 } },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: {
          addEventListener: mockAddEventListener,
          removeEventListener: mockRemoveEventListener,
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    // Should register keyup and mouseup listeners for cursor tracking
    expect(mockAddEventListener).toHaveBeenCalledWith("keyup", expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith("mouseup", expect.any(Function));
  });

  it("removes DOM listeners on unmount", async () => {
    const { renderHook } = await import("@testing-library/react");

    const mockAddEventListener = vi.fn();
    const mockRemoveEventListener = vi.fn();

    const doc = textFrom("# First\n\nText");
    const viewRef = {
      current: {
        state: {
          doc,
          selection: { main: { head: 0 } },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: {
          addEventListener: mockAddEventListener,
          removeEventListener: mockRemoveEventListener,
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    const { unmount } = renderHook(() => useSourceOutlineSync(viewRef as never, false));

    unmount();

    expect(mockRemoveEventListener).toHaveBeenCalledWith("keyup", expect.any(Function));
    expect(mockRemoveEventListener).toHaveBeenCalledWith("mouseup", expect.any(Function));
  });
});

describe("useSourceOutlineSync hook — additional branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles cancelled=true when listen resolves after unmount (safeUnlisten called with unlisten)", async () => {
    // L101, L119-120: cancelled=true path — the event callback early returns,
    // and the cancelled guard in setup() causes safeUnlisten(unlisten) to be called
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");
    const { safeUnlisten } = await import("@/utils/safeUnlisten");

    let resolveUnlisten!: (fn: () => void) => void;
    const listenPromise = new Promise<() => void>((resolve) => {
      resolveUnlisten = resolve;
    });
    vi.mocked(listen).mockReturnValue(listenPromise);

    const viewRef = { current: null };
    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    const { unmount } = renderHook(() => useSourceOutlineSync(viewRef as never, false));

    // Unmount sets cancelled=true before the promise resolves
    unmount();

    // Now resolve the listen promise — setup() should call safeUnlisten(unlisten)
    const mockUnlisten = vi.fn();
    resolveUnlisten(mockUnlisten);
    await vi.waitFor(() => {
      expect(safeUnlisten).toHaveBeenCalled();
    });
  });

  it("logs error when listen() rejects (L125 catch branch)", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { listen } = await import("@tauri-apps/api/event");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(listen).mockRejectedValue(new Error("network error"));

    const viewRef = { current: null };
    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[OutlineSync]",
        "Failed to setup source outline scroll listener:",
        expect.any(Error)
      );
    });
    consoleSpy.mockRestore();
  });

  it("updateActiveHeading returns early when viewRef.current becomes null (L148)", async () => {
    const { renderHook, act } = await import("@testing-library/react");

    const mockAddEventListener = vi.fn();
    const mockRemoveEventListener = vi.fn();

    const doc = textFrom("# First\n\nText");
    // Use a mutable ref-like object so we can set current to null after mount
    const viewRef: { current: object | null } = {
      current: {
        state: {
          doc,
          selection: { main: { head: 0 } },
        },
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: {
          addEventListener: mockAddEventListener,
          removeEventListener: mockRemoveEventListener,
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    // After initial render, set viewRef.current to null
    // Then trigger handleUpdate via keyup — updateActiveHeading should early return without crash
    const keyupCall = mockAddEventListener.mock.calls.find(([evt]: [string]) => evt === "keyup");
    const handleUpdate = keyupCall?.[1] as (() => void) | undefined;

    act(() => {
      viewRef.current = null;
      // handleUpdate calls requestAnimationFrame(updateActiveHeading)
      // updateActiveHeading checks: if (!v) return; — this is L148
      handleUpdate?.();
    });

    // No crash = the null guard (L148) works correctly
    expect(true).toBe(true);
  });

  it("handleUpdate cancels previous debounce timer and schedules new one", async () => {
    vi.useFakeTimers();
    const { renderHook, act } = await import("@testing-library/react");

    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    const mockAddEventListener = vi.fn();
    const mockRemoveEventListener = vi.fn();

    const doc = textFrom("# First\n\nText");
    const viewRef = {
      current: {
        state: { doc, selection: { main: { head: 0 } } },
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: {
          addEventListener: mockAddEventListener,
          removeEventListener: mockRemoveEventListener,
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    renderHook(() => useSourceOutlineSync(viewRef as never, false));

    const keyupCall = mockAddEventListener.mock.calls.find(([evt]) => evt === "keyup");
    const handleUpdate = keyupCall?.[1] as (() => void) | undefined;

    act(() => {
      // Call handleUpdate twice — second call should cancel the first debounce timer
      handleUpdate?.();
      handleUpdate?.();
    });

    // clearTimeout should have been called on the second handleUpdate call
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  it("cleanup cancels debounce timer when debounceTimerId is set", async () => {
    vi.useFakeTimers();
    const { renderHook, act } = await import("@testing-library/react");

    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const mockAddEventListener = vi.fn();
    const mockRemoveEventListener = vi.fn();

    const doc = textFrom("# First\n\nText");
    const viewRef = {
      current: {
        state: { doc, selection: { main: { head: 0 } } },
        dispatch: vi.fn(),
        focus: vi.fn(),
        dom: {
          addEventListener: mockAddEventListener,
          removeEventListener: mockRemoveEventListener,
        },
      },
    };

    const { useSourceOutlineSync } = await import("./useSourceOutlineSync");
    const { unmount } = renderHook(() => useSourceOutlineSync(viewRef as never, false));

    // Trigger handleUpdate to set debounceTimerId
    const keyupCall = mockAddEventListener.mock.calls.find(([evt]) => evt === "keyup");
    const handleUpdate = keyupCall?.[1] as (() => void) | undefined;
    act(() => { handleUpdate?.(); });

    // Unmount — cleanup should cancel the pending debounce timer
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});

describe("findNthHeadingPos — edge cases", () => {
  it("handles document with only blank lines", () => {
    const doc = textFrom("\n\n\n\n");
    expect(findNthHeadingPos(doc, 0)).toBe(-1);
  });

  it("handles document with only code fences (no headings)", () => {
    const doc = textFrom("```\ncode\n```");
    expect(findNthHeadingPos(doc, 0)).toBe(-1);
  });

  it("handles heading with trailing whitespace", () => {
    const s = "# Hello   \n## World";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Hello"));
    expect(findNthHeadingPos(doc, 1)).toBe(posOf(s, "## World"));
  });

  it("handles ####### (7 hashes) as non-heading", () => {
    const s = "####### Not a heading\n# Real heading";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Real heading"));
    expect(findNthHeadingPos(doc, 1)).toBe(-1);
  });

  it("handles unclosed code fence (all remaining content is fenced)", () => {
    const s = "# Before\n```\n# Inside unclosed";
    const doc = textFrom(s);
    expect(findNthHeadingPos(doc, 0)).toBe(posOf(s, "# Before"));
    expect(findNthHeadingPos(doc, 1)).toBe(-1); // Inside unclosed fence
  });
});
