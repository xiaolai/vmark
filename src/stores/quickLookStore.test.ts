import { beforeEach, describe, expect, it } from "vitest";
import { useQuickLookStore } from "./quickLookStore";

describe("quickLookStore", () => {
  beforeEach(() => {
    useQuickLookStore.setState({ isOpen: false, path: null, siblings: [], index: -1 });
  });

  // ── Default state ─────────────────────────────────────────────────

  it("initializes closed with no path", () => {
    const state = useQuickLookStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.path).toBeNull();
  });

  // ── open ──────────────────────────────────────────────────────────

  describe("open", () => {
    it("sets path and marks open", () => {
      useQuickLookStore.getState().open("/abs/path/photo.png");
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.path).toBe("/abs/path/photo.png");
    });

    it("replaces the path when opened again (prev/next navigation)", () => {
      useQuickLookStore.getState().open("/a.png");
      useQuickLookStore.getState().open("/b.png");
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.path).toBe("/b.png");
    });

    it("ignores an empty path (guard)", () => {
      useQuickLookStore.getState().open("");
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.path).toBeNull();
    });

    it("ignores a whitespace-only path (guard)", () => {
      useQuickLookStore.getState().open("   ");
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.path).toBeNull();
    });
  });

  // ── prev / next navigation ────────────────────────────────────────

  describe("prev/next navigation", () => {
    const list = ["/a.png", "/b.mp4", "/c.mp3"];

    it("open records the sibling list and the current index", () => {
      useQuickLookStore.getState().open("/b.mp4", list);
      const s = useQuickLookStore.getState();
      expect(s.siblings).toEqual(list);
      expect(s.index).toBe(1);
      expect(s.path).toBe("/b.mp4");
    });

    it("next advances to the following sibling", () => {
      useQuickLookStore.getState().open("/a.png", list);
      useQuickLookStore.getState().next();
      const s = useQuickLookStore.getState();
      expect(s.index).toBe(1);
      expect(s.path).toBe("/b.mp4");
    });

    it("prev moves to the preceding sibling", () => {
      useQuickLookStore.getState().open("/c.mp3", list);
      useQuickLookStore.getState().prev();
      const s = useQuickLookStore.getState();
      expect(s.index).toBe(1);
      expect(s.path).toBe("/b.mp4");
    });

    it("clamps at the last sibling (Finder-style, no wrap)", () => {
      useQuickLookStore.getState().open("/c.mp3", list);
      useQuickLookStore.getState().next();
      const s = useQuickLookStore.getState();
      expect(s.index).toBe(2);
      expect(s.path).toBe("/c.mp3");
    });

    it("clamps at the first sibling (no wrap)", () => {
      useQuickLookStore.getState().open("/a.png", list);
      useQuickLookStore.getState().prev();
      const s = useQuickLookStore.getState();
      expect(s.index).toBe(0);
      expect(s.path).toBe("/a.png");
    });

    it("with no sibling list, the target is a singleton and nav is a no-op", () => {
      useQuickLookStore.getState().open("/solo.png");
      expect(useQuickLookStore.getState().siblings).toEqual(["/solo.png"]);
      expect(useQuickLookStore.getState().index).toBe(0);
      useQuickLookStore.getState().next();
      useQuickLookStore.getState().prev();
      expect(useQuickLookStore.getState().path).toBe("/solo.png");
    });

    it("copies the siblings array so external mutation cannot leak into state", () => {
      const external = ["/a.png", "/b.mp4", "/c.mp3"];
      useQuickLookStore.getState().open("/b.mp4", external);
      external.push("/injected.png");
      external[0] = "/tampered.png";
      expect(useQuickLookStore.getState().siblings).toEqual([
        "/a.png",
        "/b.mp4",
        "/c.mp3",
      ]);
    });

    it("falls back to a singleton when the path is not in the provided list", () => {
      useQuickLookStore.getState().open("/x.png", ["/a.png", "/b.png"]);
      const s = useQuickLookStore.getState();
      expect(s.siblings).toEqual(["/x.png"]);
      expect(s.index).toBe(0);
    });

    it("next/prev are no-ops when the overlay is closed", () => {
      useQuickLookStore.getState().next();
      useQuickLookStore.getState().prev();
      const s = useQuickLookStore.getState();
      expect(s.isOpen).toBe(false);
      expect(s.path).toBeNull();
    });
  });

  // ── close ─────────────────────────────────────────────────────────

  describe("close", () => {
    it("clears path, siblings and index, marks closed", () => {
      useQuickLookStore.getState().open("/abs/path/photo.png", ["/abs/path/photo.png"]);
      useQuickLookStore.getState().close();
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.path).toBeNull();
      expect(state.siblings).toEqual([]);
      expect(state.index).toBe(-1);
    });

    it("is a no-op when already closed", () => {
      useQuickLookStore.getState().close();
      const state = useQuickLookStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.path).toBeNull();
    });
  });
});
