// @vitest-environment node
/**
 * Tests for blockVideo tiptap extension — node definition, attributes,
 * parseHTML, and renderHTML.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./block-video.css", () => ({}));
vi.mock("./BlockVideoNodeView", () => ({
  BlockVideoNodeView: vi.fn(),
}));
vi.mock("../shared/sourceLineAttr", () => ({
  sourceLineAttr: {},
}));
vi.mock("../shared/mediaNodeViewHelpers", () => ({
  mediaBlockKeyboardShortcuts: vi.fn(() => ({})),
}));

import { blockVideoExtension } from "./tiptap";

describe("blockVideoExtension", () => {
  it("has name 'block_video'", () => {
    expect(blockVideoExtension.name).toBe("block_video");
  });

  it("is a block atom node", () => {
    expect(blockVideoExtension.config.group).toBe("block");
    expect(blockVideoExtension.config.atom).toBe(true);
  });

  it("is isolating, selectable, draggable, defining", () => {
    expect(blockVideoExtension.config.isolating).toBe(true);
    expect(blockVideoExtension.config.selectable).toBe(true);
    expect(blockVideoExtension.config.draggable).toBe(true);
    expect(blockVideoExtension.config.defining).toBe(true);
  });

  it("does not allow marks", () => {
    expect(blockVideoExtension.config.marks).toBe("");
  });

  describe("attributes", () => {
    it("defines src, title, poster, controls, preload", () => {
      const attrs = blockVideoExtension.config.addAttributes!.call({} as never);
      expect(attrs.src).toBeDefined();
      expect(attrs.src.default).toBe("");
      expect(attrs.title).toBeDefined();
      expect(attrs.title.default).toBe("");
      expect(attrs.poster).toBeDefined();
      expect(attrs.poster.default).toBe("");
      expect(attrs.controls).toBeDefined();
      expect(attrs.controls.default).toBe(true);
      expect(attrs.preload).toBeDefined();
      expect(attrs.preload.default).toBe("metadata");
    });
  });

  describe("parseHTML", () => {
    it("matches figure[data-type='block_video']", () => {
      const rules = blockVideoExtension.config.parseHTML!.call({} as never);
      expect(rules).toHaveLength(1);
      expect(rules[0].tag).toBe('figure[data-type="block_video"]');
    });

    it("extracts attrs from video child element", () => {
      const rules = blockVideoExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = {
        querySelector: (sel: string) =>
          sel === "video"
            ? {
                getAttribute: (attr: string) => {
                  const map: Record<string, string> = {
                    src: "video.mp4",
                    title: "My video",
                    poster: "thumb.png",
                    preload: "auto",
                  };
                  return map[attr] ?? null;
                },
                hasAttribute: (attr: string) => attr === "controls",
              }
            : null,
      };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({
        src: "video.mp4",
        title: "My video",
        poster: "thumb.png",
        controls: true,
        preload: "auto",
      });
    });

    it("handles missing video element", () => {
      const rules = blockVideoExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = { querySelector: () => null };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({
        src: "",
        title: "",
        poster: "",
        controls: true,
        preload: "metadata",
      });
    });
  });

  describe("renderHTML", () => {
    it("renders as figure with video child", () => {
      const result = blockVideoExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: "vid.mp4", title: "Title", poster: "thumb.png", controls: true, preload: "metadata" } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[0]).toBe("figure");
      expect(result[1]["data-type"]).toBe("block_video");
      expect(result[1].class).toBe("block-video");
      expect(result[2][0]).toBe("video");
      expect(result[2][1].src).toBe("vid.mp4");
      expect(result[2][1].title).toBe("Title");
      expect(result[2][1].poster).toBe("thumb.png");
      expect(result[2][1].controls).toBe("controls");
      expect(result[2][1].preload).toBe("metadata");
    });

    it("omits title and poster when empty", () => {
      const result = blockVideoExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: "vid.mp4", title: "", poster: "", controls: false, preload: "none" } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[2][1].title).toBeUndefined();
      expect(result[2][1].poster).toBeUndefined();
      expect(result[2][1].controls).toBeUndefined();
    });

    it("handles null src", () => {
      const result = blockVideoExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: null, title: null, poster: null, controls: true, preload: null } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[2][1].src).toBe("");
    });
  });

  describe("node view", () => {
    it("defines addNodeView", () => {
      expect(blockVideoExtension.config.addNodeView).toBeDefined();
    });
  });

  describe("keyboard shortcuts", () => {
    it("defines addKeyboardShortcuts", () => {
      expect(blockVideoExtension.config.addKeyboardShortcuts).toBeDefined();
    });
  });
});
