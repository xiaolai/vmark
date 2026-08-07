// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { useImageContextMenuStore } from "./imageContextMenuStore";

describe("imageContextMenuStore", () => {
  beforeEach(() => {
    useImageContextMenuStore.setState({
      isOpen: false,
      position: null,
      imageSrc: "",
      imageNodePos: -1,
    });
  });

  // ── Default state ──────────────────────────────────────────────────

  it("initializes with default state", () => {
    const state = useImageContextMenuStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.position).toBeNull();
    expect(state.imageSrc).toBe("");
    expect(state.imageNodePos).toBe(-1);
  });

  // ── openMenu ──────────────────────────────────────────────────────

  describe("openMenu", () => {
    it("opens menu with position and image data", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 150, y: 300 },
        imageSrc: "https://example.com/photo.jpg",
        imageNodePos: 42,
      });

      const state = useImageContextMenuStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.position).toEqual({ x: 150, y: 300 });
      expect(state.imageSrc).toBe("https://example.com/photo.jpg");
      expect(state.imageNodePos).toBe(42);
    });

    it("handles position at origin (0, 0)", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 0, y: 0 },
        imageSrc: "img.png",
        imageNodePos: 0,
      });

      const state = useImageContextMenuStore.getState();
      expect(state.position).toEqual({ x: 0, y: 0 });
      expect(state.imageNodePos).toBe(0);
    });

    it("handles local file path as imageSrc", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 10, y: 20 },
        imageSrc: "/Users/test/Documents/image.png",
        imageNodePos: 5,
      });

      expect(useImageContextMenuStore.getState().imageSrc).toBe(
        "/Users/test/Documents/image.png"
      );
    });

    it("handles empty imageSrc", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 10, y: 20 },
        imageSrc: "",
        imageNodePos: 1,
      });

      expect(useImageContextMenuStore.getState().imageSrc).toBe("");
    });

    it("overwrites previous menu state", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 10, y: 20 },
        imageSrc: "first.png",
        imageNodePos: 1,
      });

      useImageContextMenuStore.getState().openMenu({
        position: { x: 500, y: 600 },
        imageSrc: "second.png",
        imageNodePos: 99,
      });

      const state = useImageContextMenuStore.getState();
      expect(state.position).toEqual({ x: 500, y: 600 });
      expect(state.imageSrc).toBe("second.png");
      expect(state.imageNodePos).toBe(99);
    });

    it("handles large nodePos values", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 10, y: 20 },
        imageSrc: "img.png",
        imageNodePos: 999999,
      });

      expect(useImageContextMenuStore.getState().imageNodePos).toBe(999999);
    });
  });

  // ── closeMenu ─────────────────────────────────────────────────────

  describe("closeMenu", () => {
    it("resets all state to initial values", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 100, y: 200 },
        imageSrc: "test.png",
        imageNodePos: 10,
      });

      useImageContextMenuStore.getState().closeMenu();

      const state = useImageContextMenuStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.position).toBeNull();
      expect(state.imageSrc).toBe("");
      expect(state.imageNodePos).toBe(-1);
    });

    it("is idempotent when already closed", () => {
      useImageContextMenuStore.getState().closeMenu();
      const state = useImageContextMenuStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.position).toBeNull();
    });
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("imageContextMenuStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useImageContextMenuStore.getState().closeMenu();
  });

  const initialData = { isOpen: false, position: null, imageSrc: "", imageNodePos: -1 };

  function dataOf(s: ReturnType<typeof useImageContextMenuStore.getState>) {
    const { isOpen, position, imageSrc, imageNodePos } = s;
    return { isOpen, position, imageSrc, imageNodePos };
  }

  it("no leak across sessions: open A → close → open B shows only B", () => {
    useImageContextMenuStore.getState().openMenu({
      position: { x: 1, y: 2 },
      imageSrc: "a.png",
      imageNodePos: 1,
    });
    useImageContextMenuStore.getState().closeMenu();
    useImageContextMenuStore.getState().openMenu({
      position: { x: 3, y: 4 },
      imageSrc: "b.png",
      imageNodePos: 2,
    });

    expect(dataOf(useImageContextMenuStore.getState())).toEqual({
      isOpen: true,
      position: { x: 3, y: 4 },
      imageSrc: "b.png",
      imageNodePos: 2,
    });
  });

  it("rapid open/close x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useImageContextMenuStore.getState().openMenu({
        position: { x: i, y: i },
        imageSrc: `i${i}.png`,
        imageNodePos: i,
      });
      useImageContextMenuStore.getState().closeMenu();
    }
    expect(dataOf(useImageContextMenuStore.getState())).toEqual(initialData);
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 9, y: 9 },
        imageSrc: "m.png",
        imageNodePos: 9,
      });
      expect(dataOf(useImageContextMenuStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useImageContextMenuStore.getState().openMenu({
        position: { x: 9, y: 9 },
        imageSrc: "m.png",
        imageNodePos: 9,
      });
      useImageContextMenuStore.setState(useImageContextMenuStore.getInitialState());
      expect(dataOf(useImageContextMenuStore.getState())).toEqual(initialData);
    });
  });
});
