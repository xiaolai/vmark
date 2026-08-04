import { describe, it, expect, beforeEach } from "vitest";
import { useDropZoneStore } from "./dropZoneStore";

describe("dropZoneStore", () => {
  beforeEach(() => {
    useDropZoneStore.setState({
      isDragging: false,
      hasImages: false,
      imageCount: 0,
    });
  });

  // ── Default state ──────────────────────────────────────────────────

  it("initializes with default state", () => {
    const state = useDropZoneStore.getState();
    expect(state.isDragging).toBe(false);
    expect(state.hasImages).toBe(false);
    expect(state.imageCount).toBe(0);
  });

  // ── setDragging ───────────────────────────────────────────────────

  describe("setDragging", () => {
    it("sets dragging to true without image info", () => {
      useDropZoneStore.getState().setDragging(true);
      const state = useDropZoneStore.getState();
      expect(state.isDragging).toBe(true);
      expect(state.hasImages).toBe(false);
      expect(state.imageCount).toBe(0);
    });

    it("sets dragging to true with image info", () => {
      useDropZoneStore.getState().setDragging(true, true, 3);
      const state = useDropZoneStore.getState();
      expect(state.isDragging).toBe(true);
      expect(state.hasImages).toBe(true);
      expect(state.imageCount).toBe(3);
    });

    it("sets dragging to false", () => {
      useDropZoneStore.getState().setDragging(true, true, 5);
      useDropZoneStore.getState().setDragging(false);
      const state = useDropZoneStore.getState();
      expect(state.isDragging).toBe(false);
      expect(state.hasImages).toBe(false);
      expect(state.imageCount).toBe(0);
    });

    it("defaults hasImages to false when not provided", () => {
      useDropZoneStore.getState().setDragging(true);
      expect(useDropZoneStore.getState().hasImages).toBe(false);
    });

    it("defaults imageCount to 0 when not provided", () => {
      useDropZoneStore.getState().setDragging(true, true);
      expect(useDropZoneStore.getState().imageCount).toBe(0);
    });

    it("handles imageCount of 0 with hasImages true", () => {
      useDropZoneStore.getState().setDragging(true, true, 0);
      const state = useDropZoneStore.getState();
      expect(state.hasImages).toBe(true);
      expect(state.imageCount).toBe(0);
    });

    it("handles large imageCount", () => {
      useDropZoneStore.getState().setDragging(true, true, 100);
      expect(useDropZoneStore.getState().imageCount).toBe(100);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resets all state to initial values", () => {
      useDropZoneStore.getState().setDragging(true, true, 5);
      useDropZoneStore.getState().reset();

      const state = useDropZoneStore.getState();
      expect(state.isDragging).toBe(false);
      expect(state.hasImages).toBe(false);
      expect(state.imageCount).toBe(0);
    });

    it("is idempotent when already at initial state", () => {
      useDropZoneStore.getState().reset();
      const state = useDropZoneStore.getState();
      expect(state.isDragging).toBe(false);
      expect(state.hasImages).toBe(false);
      expect(state.imageCount).toBe(0);
    });
  });
});

// T09 revert contract pins (WI-9, plan-20260803-161713): drift detectors for
// the shim → standalone re-inline. Written against the legacy public API.
describe("dropZoneStore — T09 revert contract pins", () => {
  beforeEach(() => {
    useDropZoneStore.getState().reset();
  });

  const initialData = { isDragging: false, hasImages: false, imageCount: 0 };

  function dataOf(s: ReturnType<typeof useDropZoneStore.getState>) {
    const { isDragging, hasImages, imageCount } = s;
    return { isDragging, hasImages, imageCount };
  }

  it("rapid setDragging/reset x10 lands exactly on the initial state", () => {
    for (let i = 0; i < 10; i++) {
      useDropZoneStore.getState().setDragging(true, true, i);
      useDropZoneStore.getState().reset();
    }
    expect(dataOf(useDropZoneStore.getState())).toEqual(initialData);
  });

  it("no leak across sessions: drag A → reset → drag B shows only B", () => {
    useDropZoneStore.getState().setDragging(true, true, 9);
    useDropZoneStore.getState().reset();
    useDropZoneStore.getState().setDragging(true);
    expect(dataOf(useDropZoneStore.getState())).toEqual({
      isDragging: true,
      hasImages: false,
      imageCount: 0,
    });
  });

  describe("native initial-state semantics (the legacy shim getInitialState deviation)", () => {
    it("getInitialState stays pristine after mutations", () => {
      useDropZoneStore.getState().setDragging(true, true, 3);
      expect(dataOf(useDropZoneStore.getInitialState())).toEqual(initialData);
    });

    it("setState(getInitialState()) is the native reset idiom", () => {
      useDropZoneStore.getState().setDragging(true, true, 3);
      useDropZoneStore.setState(useDropZoneStore.getInitialState());
      expect(dataOf(useDropZoneStore.getState())).toEqual(initialData);
    });
  });
});
