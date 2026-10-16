/**
 * Tests for blockImage tiptap extension — node definition, attributes,
 * parseHTML, renderHTML, keyboard shortcuts, and addNodeView. The node view
 * factory builds the REAL BlockImageNodeView; only the Tauri asset boundary
 * (`convertFileSrc`) is faked.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Schema } from "@tiptap/pm/model";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

import { blockImageExtension } from "./tiptap";
import { BlockImageNodeView } from "./BlockImageNodeView";
import { bindHostPopups } from "@/plugins/shared/hostPopups";
import { useDocumentStore } from "@/stores/documentStore";
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
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        text: {},
        block_image: { group: "block", atom: true, attrs: { src: { default: "" }, alt: { default: "" }, title: { default: "" } } },
      },
    });
    const editor = { view: {} };
    const openImageMenu = vi.fn();
    bindHostPopups({ openImageMenu, openMediaPopup: vi.fn() });

    const views: BlockImageNodeView[] = [];
    afterEach(() => {
      views.splice(0).forEach((v) => v.destroy());
      openImageMenu.mockClear();
    });

    function build(ownerTabId: string | undefined, getPos: unknown, attrs: Record<string, string>) {
      const factory = blockImageExtension.config.addNodeView!.call({ options: { ownerTabId } } as never)!;
      const node = schema.node("block_image", attrs);
      const view = factory({ node, getPos, editor, view: { dom: document.createElement("div") } } as never) as unknown as BlockImageNodeView;
      views.push(view);
      return view;
    }

    function rightClick(view: BlockImageNodeView) {
      view.dom.querySelector("img")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    }

    it("defines addNodeView", () => {
      expect(blockImageExtension.config.addNodeView).toBeDefined();
    });

    it("builds a real block image node view from the node's attributes", () => {
      const view = build(undefined, () => 5, { src: "https://example.com/a.png", alt: "Alt", title: "T" });
      expect(view).toBeInstanceOf(BlockImageNodeView);
      expect(view.dom.tagName).toBe("FIGURE");
      const img = view.dom.querySelector("img")!;
      expect(img.alt).toBe("Alt");
      expect(img.title).toBe("T");
      expect(img.getAttribute("src")).toBe("https://example.com/a.png");
    });

    it("hands the node view the function getPos (the context menu reports its position)", () => {
      const view = build(undefined, () => 5, { src: "https://example.com/a.png" });
      rightClick(view);
      expect(openImageMenu).toHaveBeenCalledWith(expect.objectContaining({ imageNodePos: 5 }));
    });

    it("resolves a relative src against the configured owner tab's document", async () => {
      // The whole point of the option: a relative `src` must resolve against
      // the document that owns the node, not the focused tab.
      useDocumentStore.getState().initDocument("tab-owner", "", "/docs/owner/note.md");
      const view = build("tab-owner", () => 5, { src: "pic.png" });
      const img = view.dom.querySelector("img")!;
      await vi.waitFor(() => expect(img.getAttribute("src")).toBe("asset://localhost/docs/owner/pic.png"));
    });

    it("wraps a non-function getPos with a fallback that answers undefined", () => {
      const view = build(undefined, true, { src: "https://example.com/a.png" });
      // An undefined position means the node view opens no menu at all.
      rightClick(view);
      expect(openImageMenu).not.toHaveBeenCalled();
    });
  });
});
