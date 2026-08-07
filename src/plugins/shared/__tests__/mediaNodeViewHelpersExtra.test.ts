// @vitest-environment node
/**
 * Extra tests for mediaNodeViewHelpers — coverage for mediaBlockKeyboardShortcuts.
 */

import { describe, it, expect, vi } from "vitest";
import { NodeSelection } from "@tiptap/pm/state";
import {
  mediaBlockKeyboardShortcuts,
  attachMediaLoadHandlers,
  type MediaLoadConfig,
} from "../mediaNodeViewHelpers";

/* ------------------------------------------------------------------ */
/*  mediaBlockKeyboardShortcuts                                        */
/* ------------------------------------------------------------------ */

describe("mediaBlockKeyboardShortcuts", () => {
  const shortcuts = mediaBlockKeyboardShortcuts("blockImage");

  describe("Enter", () => {
    it("returns false when selection is not a NodeSelection", () => {
      const editor = {
        state: {
          selection: { node: undefined },
        },
      } as never;

      expect(shortcuts.Enter({ editor } as never)).toBe(false);
    });

    it("returns false when selected node type does not match", () => {
      // Create a fake selection that passes instanceof NodeSelection
      const fakeSelection = Object.create(NodeSelection.prototype);
      Object.defineProperty(fakeSelection, "node", { value: { type: { name: "paragraph" } } });
      Object.defineProperty(fakeSelection, "to", { value: 5 });

      const editor = {
        state: { selection: fakeSelection },
        chain: vi.fn(),
      } as never;

      expect(shortcuts.Enter({ editor } as never)).toBe(false);
    });

    it("inserts paragraph when selected node matches", () => {
      const fakeSelection = Object.create(NodeSelection.prototype);
      Object.defineProperty(fakeSelection, "node", { value: { type: { name: "blockImage" } } });
      Object.defineProperty(fakeSelection, "to", { value: 10 });

      const runFn = vi.fn();
      const setTextSelectionFn = vi.fn().mockReturnValue({ run: runFn });
      const insertContentAtFn = vi.fn().mockReturnValue({ setTextSelection: setTextSelectionFn });
      const chainFn = vi.fn().mockReturnValue({ insertContentAt: insertContentAtFn });

      const editor = {
        state: { selection: fakeSelection },
        chain: chainFn,
      } as never;

      const result = shortcuts.Enter({ editor } as never);

      expect(result).toBe(true);
      expect(chainFn).toHaveBeenCalled();
      expect(insertContentAtFn).toHaveBeenCalledWith(10, { type: "paragraph" });
      expect(setTextSelectionFn).toHaveBeenCalledWith(11);
      expect(runFn).toHaveBeenCalled();
    });
  });

  describe("ArrowUp", () => {
    it("returns false when cursor is not at start of block", () => {
      const editor = {
        state: {
          selection: {
            $from: {
              parentOffset: 5, // Not at start
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowUp({ editor } as never)).toBe(false);
    });

    it("returns false when before position is 0", () => {
      const editor = {
        state: {
          selection: {
            $from: {
              parentOffset: 0,
              before: () => 0,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowUp({ editor } as never)).toBe(false);
    });

    it("returns false when node before is not the target type", () => {
      const editor = {
        state: {
          doc: {
            resolve: () => ({
              nodeBefore: { type: { name: "paragraph" }, nodeSize: 2 },
            }),
          },
          selection: {
            $from: {
              parentOffset: 0,
              before: () => 5,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowUp({ editor } as never)).toBe(false);
    });

    it("returns false when nodeBefore is null", () => {
      const editor = {
        state: {
          doc: {
            resolve: () => ({
              nodeBefore: null,
            }),
          },
          selection: {
            $from: {
              parentOffset: 0,
              before: () => 5,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowUp({ editor } as never)).toBe(false);
    });

    it("selects the node when node before matches", () => {
      const setNodeSelection = vi.fn().mockReturnValue(true);
      const editor = {
        state: {
          doc: {
            resolve: () => ({
              nodeBefore: { type: { name: "blockImage" }, nodeSize: 3 },
            }),
          },
          selection: {
            $from: {
              parentOffset: 0,
              before: () => 5,
            },
          },
        },
        commands: { setNodeSelection },
      } as never;

      const result = shortcuts.ArrowUp({ editor } as never);

      expect(result).toBe(true);
      expect(setNodeSelection).toHaveBeenCalledWith(2); // 5 - 3 = 2
    });
  });

  describe("ArrowDown", () => {
    it("returns false when cursor is not at end of block", () => {
      const editor = {
        state: {
          selection: {
            $to: {
              parentOffset: 2,
              parent: { content: { size: 5 } },
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowDown({ editor } as never)).toBe(false);
    });

    it("returns false when after position is at doc end", () => {
      const editor = {
        state: {
          doc: { content: { size: 10 } },
          selection: {
            $to: {
              parentOffset: 5,
              parent: { content: { size: 5 } },
              after: () => 10,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowDown({ editor } as never)).toBe(false);
    });

    it("returns false when nodeAfter is not the target type", () => {
      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            resolve: () => ({
              nodeAfter: { type: { name: "paragraph" } },
            }),
          },
          selection: {
            $to: {
              parentOffset: 5,
              parent: { content: { size: 5 } },
              after: () => 8,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowDown({ editor } as never)).toBe(false);
    });

    it("returns false when nodeAfter is null", () => {
      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            resolve: () => ({
              nodeAfter: null,
            }),
          },
          selection: {
            $to: {
              parentOffset: 5,
              parent: { content: { size: 5 } },
              after: () => 8,
            },
          },
        },
      } as never;

      expect(shortcuts.ArrowDown({ editor } as never)).toBe(false);
    });

    it("selects the node when node after matches", () => {
      const setNodeSelection = vi.fn().mockReturnValue(true);
      const editor = {
        state: {
          doc: {
            content: { size: 20 },
            resolve: () => ({
              nodeAfter: { type: { name: "blockImage" } },
            }),
          },
          selection: {
            $to: {
              parentOffset: 5,
              parent: { content: { size: 5 } },
              after: () => 8,
            },
          },
        },
        commands: { setNodeSelection },
      } as never;

      const result = shortcuts.ArrowDown({ editor } as never);

      expect(result).toBe(true);
      expect(setNodeSelection).toHaveBeenCalledWith(8);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  attachMediaLoadHandlers — double-cleanup idempotence               */
/* ------------------------------------------------------------------ */

describe("attachMediaLoadHandlers — double cleanup", () => {
  const imageConfig: MediaLoadConfig = {
    loadEvent: "load",
    loadingClass: "image-loading",
    errorClass: "image-error",
  };

  it("double cleanup is safe (idempotent)", () => {
    const element = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    const container = {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    } as unknown as HTMLElement;

    const cleanup = attachMediaLoadHandlers(element, container, imageConfig, vi.fn());

    cleanup();
    cleanup(); // second call should be safe

    // removeEventListener called exactly once per event (not twice)
    expect(element.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("load event triggers cleanup internally (no double removal)", () => {
    const listeners: Record<string, EventListener> = {};
    const element = {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners[event] = handler;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLImageElement;

    const container = {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
      },
    } as unknown as HTMLElement;

    const onLoaded = vi.fn();
    const cleanup = attachMediaLoadHandlers(element, container, imageConfig, onLoaded);

    // Trigger load event (calls internal cleanup)
    listeners["load"](new Event("load"));
    expect(onLoaded).toHaveBeenCalled();

    // External cleanup should be safe (already cleaned up internally)
    cleanup();

    // removeEventListener should be called exactly twice (once per event, from internal cleanup)
    expect(element.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
