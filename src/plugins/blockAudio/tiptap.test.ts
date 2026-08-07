// @vitest-environment node
/**
 * Tests for blockAudio tiptap extension — node definition, attributes,
 * parseHTML, and renderHTML.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./block-audio.css", () => ({}));
vi.mock("./BlockAudioNodeView", () => ({
  BlockAudioNodeView: vi.fn(),
}));
vi.mock("../shared/sourceLineAttr", () => ({
  sourceLineAttr: {},
}));
vi.mock("../shared/mediaNodeViewHelpers", () => ({
  mediaBlockKeyboardShortcuts: vi.fn(() => ({})),
}));

import { blockAudioExtension } from "./tiptap";

describe("blockAudioExtension", () => {
  it("has name 'block_audio'", () => {
    expect(blockAudioExtension.name).toBe("block_audio");
  });

  it("is a block atom node", () => {
    expect(blockAudioExtension.config.group).toBe("block");
    expect(blockAudioExtension.config.atom).toBe(true);
  });

  it("is isolating, selectable, draggable, defining", () => {
    expect(blockAudioExtension.config.isolating).toBe(true);
    expect(blockAudioExtension.config.selectable).toBe(true);
    expect(blockAudioExtension.config.draggable).toBe(true);
    expect(blockAudioExtension.config.defining).toBe(true);
  });

  it("does not allow marks", () => {
    expect(blockAudioExtension.config.marks).toBe("");
  });

  describe("attributes", () => {
    it("defines src, title, controls, preload", () => {
      const attrs = blockAudioExtension.config.addAttributes!.call({} as never);
      expect(attrs.src).toBeDefined();
      expect(attrs.src.default).toBe("");
      expect(attrs.title).toBeDefined();
      expect(attrs.title.default).toBe("");
      expect(attrs.controls).toBeDefined();
      expect(attrs.controls.default).toBe(true);
      expect(attrs.preload).toBeDefined();
      expect(attrs.preload.default).toBe("metadata");
    });
  });

  describe("parseHTML", () => {
    it("matches figure[data-type='block_audio']", () => {
      const rules = blockAudioExtension.config.parseHTML!.call({} as never);
      expect(rules).toHaveLength(1);
      expect(rules[0].tag).toBe('figure[data-type="block_audio"]');
    });

    it("extracts attrs from audio child element", () => {
      const rules = blockAudioExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = {
        querySelector: (sel: string) =>
          sel === "audio"
            ? {
                getAttribute: (attr: string) => {
                  const map: Record<string, string> = {
                    src: "song.mp3",
                    title: "Song",
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
        src: "song.mp3",
        title: "Song",
        controls: true,
        preload: "auto",
      });
    });

    it("handles missing audio element", () => {
      const rules = blockAudioExtension.config.parseHTML!.call({} as never);
      const getAttrs = rules[0].getAttrs!;
      const mockDom = { querySelector: () => null };
      const attrs = getAttrs(mockDom as never);
      expect(attrs).toEqual({
        src: "",
        title: "",
        controls: true,
        preload: "metadata",
      });
    });
  });

  describe("renderHTML", () => {
    it("renders as figure with audio child", () => {
      const result = blockAudioExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: "audio.mp3", title: "Audio", controls: true, preload: "metadata" } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[0]).toBe("figure");
      expect(result[1]["data-type"]).toBe("block_audio");
      expect(result[1].class).toBe("block-audio");
      expect(result[2][0]).toBe("audio");
      expect(result[2][1].src).toBe("audio.mp3");
      expect(result[2][1].title).toBe("Audio");
      expect(result[2][1].controls).toBe("controls");
      expect(result[2][1].preload).toBe("metadata");
    });

    it("omits title when empty", () => {
      const result = blockAudioExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: "a.mp3", title: "", controls: false, preload: "none" } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[2][1].title).toBeUndefined();
      expect(result[2][1].controls).toBeUndefined();
    });

    it("handles null src", () => {
      const result = blockAudioExtension.config.renderHTML!.call(
        {} as never,
        {
          node: { attrs: { src: null, title: null, controls: true, preload: null } },
          HTMLAttributes: {},
        } as never
      );
      expect(result[2][1].src).toBe("");
    });
  });

  describe("node view", () => {
    it("defines addNodeView", () => {
      expect(blockAudioExtension.config.addNodeView).toBeDefined();
    });
  });

  describe("keyboard shortcuts", () => {
    it("defines addKeyboardShortcuts", () => {
      expect(blockAudioExtension.config.addKeyboardShortcuts).toBeDefined();
    });
  });
});
