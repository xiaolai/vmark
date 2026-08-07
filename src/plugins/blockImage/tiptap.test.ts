// @vitest-environment node
/**
 * Tests for blockImage tiptap extension — node definition, attributes,
 * parseHTML, renderHTML, keyboard shortcuts, and addNodeView.
 */

import { describe, it, expect, vi } from "vitest";

// Mock CSS and node view
const { MockBlockImageNodeView } = vi.hoisted(() => ({
  MockBlockImageNodeView: vi.fn(),
}));
vi.mock("./block-image.css", () => ({}));
vi.mock("./BlockImageNodeView", () => ({
  BlockImageNodeView: MockBlockImageNodeView,
}));
vi.mock("../shared/sourceLineAttr", () => ({
  sourceLineAttr: {},
}));

import { blockImageExtension } from "./tiptap";
import { NodeSelection } from "@tiptap/pm/state";

describe("blockImageExtension", () => {
  it("has name 'block_image'", () => {
    expect(blockImageExtension.name).toBe("block_image");
  });

  it("is a block node", () => {
    expect(blockImageExtension.config.group).toBe("block");
  });

  it("is an atom node", () => {
    expect(blockImageExtension.config.atom).toBe(true);
  });

  it("is isolating", () => {
    expect(blockImageExtension.config.isolating).toBe(true);
  });

  it("is selectable", () => {
    expect(blockImageExtension.config.selectable).toBe(true);
  });

  it("is draggable", () => {
    expect(blockImageExtension.config.draggable).toBe(true);
  });

  it("does not allow marks", () => {
    expect(blockImageExtension.config.marks).toBe("");
  });

  it("is a defining node", () => {
    expect(blockImageExtension.config.defining).toBe(true);
  });

  describe("attributes", () => {
    it("defines src, alt, title attributes", () => {
      const attrs = blockImageExtension.config.addAttributes!.call({} as never);
      expect(attrs.src).toBeDefined();
      expect(attrs.src.default).toBe("");
      expect(attrs.alt).toBeDefined();
      expect(attrs.alt.default).toBe("");
      expect(attrs.title).toBeDefined();
      expect(attrs.title.default).toBe("");
    });
  });

  describe("parseHTML", () => {
    it("matches figure[data-type='block_image']", () => {
      const rules = blockImageExtension.config.parseHTML!.call({} as never);
      expect(rules).toHaveLength(1);
      expect(rules[0].tag).toBe('figure[data-type="block_image"]');
    });

    it("extracts attrs from img child element", () => {
      const rules = blockImageExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = {
        querySelector: (sel: string) =>
          sel === "img"
            ? {
                getAttribute: (attr: string) => {
                  const map: Record<string, string> = { src: "pic.png", alt: "desc", title: "My pic" };
                  return map[attr] ?? null;
                },
              }
            : null,
      };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({ src: "pic.png", alt: "desc", title: "My pic" });
    });

    it("defaults to empty strings when img has no attributes", () => {
      const rules = blockImageExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = {
        querySelector: () => ({ getAttribute: () => null }),
      };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({ src: "", alt: "", title: "" });
    });

    it("handles missing img element", () => {
      const rules = blockImageExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = { querySelector: () => null };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({ src: "", alt: "", title: "" });
    });
  });

  describe("renderHTML", () => {
    it("renders as figure with img child", () => {
      const result = blockImageExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: "test.png", alt: "alt text", title: "title text" } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[0]).toBe("figure");
      expect(result[1]["data-type"]).toBe("block_image");
      expect(result[1].class).toBe("block-image");
      expect(result[2][0]).toBe("img");
      expect(result[2][1].src).toBe("test.png");
      expect(result[2][1].alt).toBe("alt text");
      expect(result[2][1].title).toBe("title text");
    });

    it("handles null/undefined attrs", () => {
      const result = blockImageExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: null, alt: undefined, title: null } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[2][1].src).toBe("");
      expect(result[2][1].alt).toBe("");
      expect(result[2][1].title).toBe("");
    });
  });

  describe("keyboard shortcuts", () => {
    function getShortcuts() {
      return blockImageExtension.config.addKeyboardShortcuts!.call({} as never);
    }

    it("defines Enter, ArrowUp, ArrowDown shortcuts", () => {
      const shortcuts = getShortcuts();
      expect(shortcuts).toHaveProperty("Enter");
      expect(shortcuts).toHaveProperty("ArrowUp");
      expect(shortcuts).toHaveProperty("ArrowDown");
    });

    describe("Enter", () => {
      it("returns false when selection is not NodeSelection", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: { from: 0, to: 5 }, // TextSelection, not NodeSelection
          },
        };
        const result = shortcuts.Enter({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when selected node is not block_image", () => {
        const shortcuts = getShortcuts();
        const sel = Object.create(NodeSelection.prototype, {
          node: { value: { type: { name: "paragraph" } }, writable: true },
          to: { value: 10, writable: true },
        });
        const mockEditor = {
          state: { selection: sel },
        };
        const result = shortcuts.Enter({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("inserts paragraph after block_image and returns true", () => {
        const shortcuts = getShortcuts();
        const sel = Object.create(NodeSelection.prototype, {
          node: { value: { type: { name: "block_image" } }, writable: true },
          to: { value: 10, writable: true },
        });

        const runMock = vi.fn();
        const setTextSelectionMock = vi.fn(() => ({ run: runMock }));
        const insertContentAtMock = vi.fn(() => ({ setTextSelection: setTextSelectionMock }));
        const chainMock = vi.fn(() => ({ insertContentAt: insertContentAtMock }));

        const mockEditor = {
          state: { selection: sel },
          chain: chainMock,
        };

        const result = shortcuts.Enter({ editor: mockEditor } as never);
        expect(result).toBe(true);
        expect(chainMock).toHaveBeenCalled();
        expect(insertContentAtMock).toHaveBeenCalledWith(10, { type: "paragraph" });
        expect(setTextSelectionMock).toHaveBeenCalledWith(11);
        expect(runMock).toHaveBeenCalled();
      });
    });

    describe("ArrowUp", () => {
      it("returns false when not at start of block", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $from: {
                parentOffset: 5, // not at start
              },
            },
          },
        };
        const result = shortcuts.ArrowUp({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when before position is 0 (at doc start)", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $from: {
                parentOffset: 0,
                before: () => 0,
              },
            },
          },
        };
        const result = shortcuts.ArrowUp({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when previous node is not block_image", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $from: {
                parentOffset: 0,
                before: () => 5,
              },
            },
            doc: {
              resolve: () => ({
                nodeBefore: { type: { name: "paragraph" }, nodeSize: 3 },
              }),
            },
          },
        };
        const result = shortcuts.ArrowUp({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when nodeBefore is null", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $from: {
                parentOffset: 0,
                before: () => 5,
              },
            },
            doc: {
              resolve: () => ({ nodeBefore: null }),
            },
          },
        };
        const result = shortcuts.ArrowUp({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("selects block_image above and returns true", () => {
        const shortcuts = getShortcuts();
        const setNodeSelectionMock = vi.fn(() => true);
        const mockEditor = {
          state: {
            selection: {
              $from: {
                parentOffset: 0,
                before: () => 5,
              },
            },
            doc: {
              resolve: () => ({
                nodeBefore: { type: { name: "block_image" }, nodeSize: 3 },
              }),
            },
          },
          commands: { setNodeSelection: setNodeSelectionMock },
        };
        const result = shortcuts.ArrowUp({ editor: mockEditor } as never);
        expect(result).toBe(true);
        // imagePos = before(5) - nodeSize(3) = 2
        expect(setNodeSelectionMock).toHaveBeenCalledWith(2);
      });
    });

    describe("ArrowDown", () => {
      it("returns false when not at end of block", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $to: {
                parentOffset: 3,
                parent: { content: { size: 10 } },
              },
            },
          },
        };
        const result = shortcuts.ArrowDown({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when after position is at end of doc", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $to: {
                parentOffset: 5,
                parent: { content: { size: 5 } },
                after: () => 20,
              },
            },
            doc: { content: { size: 20 } },
          },
        };
        const result = shortcuts.ArrowDown({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when next node is not block_image", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $to: {
                parentOffset: 5,
                parent: { content: { size: 5 } },
                after: () => 10,
              },
            },
            doc: {
              content: { size: 30 },
              resolve: () => ({
                nodeAfter: { type: { name: "paragraph" } },
              }),
            },
          },
        };
        const result = shortcuts.ArrowDown({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("returns false when nodeAfter is null", () => {
        const shortcuts = getShortcuts();
        const mockEditor = {
          state: {
            selection: {
              $to: {
                parentOffset: 5,
                parent: { content: { size: 5 } },
                after: () => 10,
              },
            },
            doc: {
              content: { size: 30 },
              resolve: () => ({ nodeAfter: null }),
            },
          },
        };
        const result = shortcuts.ArrowDown({ editor: mockEditor } as never);
        expect(result).toBe(false);
      });

      it("selects block_image below and returns true", () => {
        const shortcuts = getShortcuts();
        const setNodeSelectionMock = vi.fn(() => true);
        const mockEditor = {
          state: {
            selection: {
              $to: {
                parentOffset: 5,
                parent: { content: { size: 5 } },
                after: () => 10,
              },
            },
            doc: {
              content: { size: 30 },
              resolve: () => ({
                nodeAfter: { type: { name: "block_image" } },
              }),
            },
          },
          commands: { setNodeSelection: setNodeSelectionMock },
        };
        const result = shortcuts.ArrowDown({ editor: mockEditor } as never);
        expect(result).toBe(true);
        expect(setNodeSelectionMock).toHaveBeenCalledWith(10);
      });
    });
  });

  describe("addNodeView", () => {
    it("defines addNodeView", () => {
      expect(blockImageExtension.config.addNodeView).toBeDefined();
    });

    it("creates BlockImageNodeView with function getPos", () => {
      MockBlockImageNodeView.mockClear();
      const factory = blockImageExtension.config.addNodeView!.call({} as never);
      const mockNode = { type: { name: "block_image" } };
      const mockGetPos = vi.fn(() => 5);
      const mockEditor = { view: {} };

      factory({ node: mockNode, getPos: mockGetPos, editor: mockEditor } as never);

      expect(MockBlockImageNodeView).toHaveBeenCalledWith(mockNode, mockGetPos, mockEditor);
    });

    it("wraps non-function getPos with fallback returning undefined", () => {
      MockBlockImageNodeView.mockClear();
      const factory = blockImageExtension.config.addNodeView!.call({} as never);
      const mockNode = { type: { name: "block_image" } };
      const mockEditor = { view: {} };

      factory({ node: mockNode, getPos: true, editor: mockEditor } as never);

      expect(MockBlockImageNodeView).toHaveBeenCalledTimes(1);
      // The second arg should be the fallback function
      const safeGetPos = MockBlockImageNodeView.mock.calls[0][1];
      expect(typeof safeGetPos).toBe("function");
      expect(safeGetPos()).toBeUndefined();
    });
  });
});
