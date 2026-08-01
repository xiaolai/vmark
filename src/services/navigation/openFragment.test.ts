/**
 * Cross-file `#fragment` navigation — the TIMING is the whole test.
 *
 * Navigating to a heading is a solved problem (`navigateToHeadingById`). What
 * made `foo.md#heading` land at the top of the document is that
 * `handleOpenFile` resolves before the tab's editor has mounted, so a
 * navigation attempted at that moment has nothing to scroll.
 *
 * @coordinates-with services/navigation/openFragment.ts
 * @module services/navigation/openFragment.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const navigateToHeadingById = vi.fn();
vi.mock("@/utils/headingSlug", () => ({
  navigateToHeadingById: (...args: unknown[]) => navigateToHeadingById(...args),
}));

import { navigateToFragmentWhenReady } from "./openFragment";
import { useEditorStore } from "@/stores/editorStore";

/** Stand-in for a mounted Tiptap editor — only `.view` is read. */
const mountedEditor = { view: { mounted: true } } as never;

function setActiveEditor(editor: unknown): void {
  useEditorStore.setState((s) => ({
    ...s,
    active: { ...s.active, activeWysiwygEditor: editor as never },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  navigateToHeadingById.mockReset();
  navigateToHeadingById.mockReturnValue(true);
  setActiveEditor(null);
});

afterEach(() => {
  vi.useRealTimers();
  setActiveEditor(null);
});

describe("navigates as soon as the editor is there", () => {
  it("goes immediately when the editor is already mounted", () => {
    setActiveEditor(mountedEditor);
    navigateToFragmentWhenReady("main", "some-heading");
    expect(navigateToHeadingById).toHaveBeenCalledWith(mountedEditor.view, "some-heading");
  });

  it("WAITS for a late mount instead of giving up", () => {
    // The actual defect. At the moment the open resolves there is no editor;
    // a one-shot attempt here is why the anchor was silently dropped.
    navigateToFragmentWhenReady("main", "later-heading");
    expect(navigateToHeadingById).not.toHaveBeenCalled();

    setActiveEditor(mountedEditor);
    vi.advanceTimersByTime(200);

    expect(navigateToHeadingById).toHaveBeenCalledWith(mountedEditor.view, "later-heading");
  });

  it("stops retrying once it has navigated", () => {
    navigateToFragmentWhenReady("main", "h");
    setActiveEditor(mountedEditor);
    vi.advanceTimersByTime(200);
    const callsAfterSuccess = navigateToHeadingById.mock.calls.length;

    vi.advanceTimersByTime(5000);
    expect(navigateToHeadingById.mock.calls.length).toBe(callsAfterSuccess);
  });
});

describe("gives up quietly rather than spinning", () => {
  it("stops after a bounded number of attempts with no editor", () => {
    navigateToFragmentWhenReady("main", "never-mounts");
    vi.advanceTimersByTime(60_000);
    // Never navigated, and no timers left running.
    expect(navigateToHeadingById).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps retrying while the heading is ABSENT but the editor is up", () => {
    // A link can point at an anchor that no longer exists. The file still
    // opened; the document simply stays where it is. That must not be an error
    // and must not retry forever.
    navigateToHeadingById.mockReturnValue(false);
    setActiveEditor(mountedEditor);

    navigateToFragmentWhenReady("main", "gone");
    vi.advanceTimersByTime(60_000);

    expect(navigateToHeadingById.mock.calls.length).toBeGreaterThan(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("refuses work it should not do", () => {
  it("does nothing for an empty fragment", () => {
    setActiveEditor(mountedEditor);
    navigateToFragmentWhenReady("main", "");
    expect(navigateToHeadingById).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying when navigation throws — the editor is present", () => {
    setActiveEditor(mountedEditor);
    navigateToHeadingById.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => navigateToFragmentWhenReady("main", "h")).not.toThrow();
    vi.advanceTimersByTime(60_000);
    expect(navigateToHeadingById.mock.calls.length).toBe(1);
  });
});
