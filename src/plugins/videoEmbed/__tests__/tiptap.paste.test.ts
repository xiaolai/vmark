// Split from tiptap.test.ts per the test-file size gate (WI-7): all paste-
// handler describes live here. Mocks/helpers replicated (vi.mock is per-module).
/**
 * Tests for videoEmbed tiptap extension — schema, attributes, parseHTML,
 * renderHTML, paste handler, node configuration.
 */

import { describe, it, expect, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";

// Mock the VideoEmbedNodeView to avoid DOM complexity
vi.mock("../VideoEmbedNodeView", () => ({
  VideoEmbedNodeView: vi.fn(),
}));

// Allow tests to override getProviderConfig behaviour
const mockGetProviderConfig = vi.fn();
vi.mock("@/utils/videoProviderRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/videoProviderRegistry")>();
  return {
    ...actual,
    getProviderConfig: (...args: unknown[]) => {
      const override = mockGetProviderConfig(...args);
      return override !== undefined ? override : actual.getProviderConfig(args[0] as import("@/utils/videoProviderRegistry").VideoProvider);
    },
  };
});

import { videoEmbedExtension } from "../tiptap";

// ---------------------------------------------------------------------------
// Schema helper
// ---------------------------------------------------------------------------

function createSchema() {
  return getSchema([StarterKit, videoEmbedExtension]);
}


describe("videoEmbed paste handler", () => {
  function getPasteHandler() {
    const schema = createSchema();
    const nodeType = schema.nodes.video_embed;
    const plugins = videoEmbedExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "video_embed",
      options: {},
      storage: {},
      type: nodeType,
      parent: undefined,
    } as never);
    // The paste handler plugin is the one returned by addProseMirrorPlugins
    return (plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } }).props.handlePaste;
  }

  it("returns false when clipboardData is null", () => {
    const handlePaste = getPasteHandler();
    const result = handlePaste({}, { clipboardData: null });
    expect(result).toBe(false);
  });

  it("returns false when clipboard has HTML content", () => {
    const handlePaste = getPasteHandler();
    const result = handlePaste({}, {
      clipboardData: {
        getData: (type: string) => type === "text/html" ? "<p>html</p>" : "",
      },
    });
    expect(result).toBe(false);
  });

  it("returns false when clipboard has no text", () => {
    const handlePaste = getPasteHandler();
    const result = handlePaste({}, {
      clipboardData: {
        getData: (type: string) => type === "text/html" ? "" : "",
      },
    });
    expect(result).toBe(false);
  });

  it("returns false for non-video URL", () => {
    const handlePaste = getPasteHandler();
    const result = handlePaste({}, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://example.com" : "",
      },
    });
    expect(result).toBe(false);
  });

  it("preserves the Vimeo privacy hash when pasting an unlisted URL (WI-6)", () => {
    // ONE schema for both the plugin harness and the state: a node created
    // from a different Schema instance is silently dropped by slice fitting,
    // which would fake a pass/fail here.
    const schema = createSchema();
    const nodeType = schema.nodes.video_embed;
    const plugins = videoEmbedExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "video_embed",
      options: {},
      storage: {},
      type: nodeType,
      parent: undefined,
    } as never);
    const handlePaste = (plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } }).props.handlePaste;
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ doc });

    const dispatched: unknown[] = [];
    const mockView = {
      state,
      dispatch: (tr: unknown) => dispatched.push(tr),
    };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) =>
          type === "text/plain" ? "https://vimeo.com/123456789/abcDEF123" : "",
      },
    });

    expect(result).toBe(true);
    const tr = dispatched[0] as { doc: { descendants: (fn: (node: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } };
    let hash: unknown = null;
    tr.doc.descendants((node) => {
      if (node.type.name === "video_embed") hash = node.attrs.privacyHash;
    });
    expect(hash).toBe("abcDEF123");
  });

  it("returns true and dispatches for YouTube URL", () => {
    const handlePaste = getPasteHandler();
    const schema = createSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ doc });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
    };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : "",
      },
    });
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("returns true and dispatches for Vimeo URL", () => {
    const handlePaste = getPasteHandler();
    const schema = createSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ doc });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
    };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://vimeo.com/123456789" : "",
      },
    });
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("returns true and dispatches for Bilibili URL", () => {
    const handlePaste = getPasteHandler();
    const schema = createSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ doc });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
    };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://www.bilibili.com/video/BV1234567890" : "",
      },
    });
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("handles YouTube URL with extra whitespace", () => {
    const handlePaste = getPasteHandler();
    const schema = createSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ doc });

    const mockDispatch = vi.fn();
    const mockView = {
      state,
      dispatch: mockDispatch,
    };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "  https://youtu.be/dQw4w9WgXcQ  " : "",
      },
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Other plugin specs
// ---------------------------------------------------------------------------

describe("videoEmbed paste handler — getProviderConfig returns null (lines 158-159)", () => {
  it("falls back to 560x315 when getProviderConfig returns null for the pasted provider", () => {
    // Override getProviderConfig to return null for this one call
    mockGetProviderConfig.mockReturnValueOnce(null);

    const schema = createSchema();
    const nodeType = schema.nodes.video_embed;
    const plugins = videoEmbedExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "video_embed",
      options: {},
      storage: {},
      type: nodeType,
      parent: undefined,
    } as never);
    const handlePaste = (plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } }).props.handlePaste;

    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ schema, doc });
    const mockDispatch = vi.fn();

    const result = handlePaste(
      { state, dispatch: mockDispatch },
      {
        clipboardData: {
          getData: (type: string) => type === "text/plain" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : "",
        },
      },
    );

    // Should still succeed — the node is created with fallback dimensions
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
    // Verify the dispatched transaction inserted a video_embed node with defaults
    const tr = mockDispatch.mock.calls[0][0] as { doc: { firstChild: { attrs: Record<string, unknown> } } };
    const node = tr.doc?.firstChild;
    if (node && node.attrs) {
      expect(node.attrs.width).toBe(560);
      expect(node.attrs.height).toBe(315);
    }
  });
});

describe("videoEmbed paste handler — config defaults coverage (lines 154-159)", () => {
  function getPasteHandlerWithSchema() {
    const schema = createSchema();
    const nodeType = schema.nodes.video_embed;
    const plugins = videoEmbedExtension.config.addProseMirrorPlugins!.call({
      editor: {},
      name: "video_embed",
      options: {},
      storage: {},
      type: nodeType,
      parent: undefined,
    } as never);
    const handlePaste = (plugins[0] as { props: { handlePaste: (view: unknown, event: unknown) => boolean } }).props.handlePaste;
    return { schema, handlePaste };
  }

  it("creates node with provider config defaults when pasting a YouTube URL", () => {
    const { schema, handlePaste } = getPasteHandlerWithSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ schema, doc });

    const mockDispatch = vi.fn();
    const mockView = { state, dispatch: mockDispatch };

    // Use a valid 11-char YouTube video ID
    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : "",
      },
    });
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });

  it("creates node with Bilibili provider config defaults when pasting a Bilibili URL", () => {
    const { schema, handlePaste } = getPasteHandlerWithSchema();
    const doc = schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
    const state = EditorState.create({ schema, doc });

    const mockDispatch = vi.fn();
    const mockView = { state, dispatch: mockDispatch };

    const result = handlePaste(mockView, {
      clipboardData: {
        getData: (type: string) => type === "text/plain" ? "https://www.bilibili.com/video/BV1234567890" : "",
      },
    });
    expect(result).toBe(true);
    expect(mockDispatch).toHaveBeenCalled();
  });
});
