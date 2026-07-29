/**
 * Tests for videoEmbed tiptap extension — schema, attributes, parseHTML,
 * renderHTML, paste handler, node configuration.
 */

import { describe, it, expect, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DOMSerializer, DOMParser as PMDOMParser } from "@tiptap/pm/model";

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

function createVideoDoc(attrs: { provider?: string; videoId?: string; width?: number; height?: number } = {}) {
  const schema = createSchema();
  const videoNode = schema.nodes.video_embed.create({
    provider: attrs.provider ?? "youtube",
    videoId: attrs.videoId ?? "dQw4w9WgXcQ",
    width: attrs.width ?? 560,
    height: attrs.height ?? 315,
  });
  const doc = schema.nodes.doc.create(null, [videoNode]);
  return { schema, doc };
}

// ---------------------------------------------------------------------------
// Extension metadata
// ---------------------------------------------------------------------------

describe("videoEmbedExtension metadata", () => {
  it("has correct name", () => {
    expect(videoEmbedExtension.name).toBe("video_embed");
  });

  it("is a block group node", () => {
    expect(videoEmbedExtension.config.group).toBe("block");
  });

  it("is an atom node", () => {
    expect(videoEmbedExtension.config.atom).toBe(true);
  });

  it("is isolating", () => {
    expect(videoEmbedExtension.config.isolating).toBe(true);
  });

  it("is selectable", () => {
    expect(videoEmbedExtension.config.selectable).toBe(true);
  });

  it("is draggable", () => {
    expect(videoEmbedExtension.config.draggable).toBe(true);
  });

  it("allows no marks", () => {
    expect(videoEmbedExtension.config.marks).toBe("");
  });

  it("is defining", () => {
    expect(videoEmbedExtension.config.defining).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addAttributes
// ---------------------------------------------------------------------------

describe("videoEmbed addAttributes", () => {
  it("has provider attribute defaulting to youtube", () => {
    const schema = createSchema();
    expect(schema.nodes.video_embed.spec.attrs?.provider?.default).toBe("youtube");
  });

  it("has videoId attribute defaulting to empty string", () => {
    const schema = createSchema();
    expect(schema.nodes.video_embed.spec.attrs?.videoId?.default).toBe("");
  });

  it("has width attribute defaulting to 560", () => {
    const schema = createSchema();
    expect(schema.nodes.video_embed.spec.attrs?.width?.default).toBe(560);
  });

  it("has height attribute defaulting to 315", () => {
    const schema = createSchema();
    expect(schema.nodes.video_embed.spec.attrs?.height?.default).toBe(315);
  });

  it("has sourceLine attribute defaulting to null", () => {
    const schema = createSchema();
    expect(schema.nodes.video_embed.spec.attrs?.sourceLine?.default).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseHTML
// ---------------------------------------------------------------------------

describe("videoEmbed parseHTML", () => {
  it("defines at least 2 parse rules", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    expect(parseRules).toBeDefined();
    expect(parseRules!.length).toBeGreaterThanOrEqual(2);
  });

  it("first rule matches figure[data-type='video_embed']", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    expect(parseRules![0].tag).toBe('figure[data-type="video_embed"]');
  });

  it("second rule matches iframe tag", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    expect(parseRules![1].tag).toBe("iframe");
  });

  it("parses figure with video_embed data-type from DOM", () => {
    const schema = createSchema();
    const html = `<figure data-type="video_embed" data-provider="youtube">
      <iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" width="560" height="315" data-video-id="dQw4w9WgXcQ"></iframe>
    </figure>`;
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("video_embed");
    expect(node.attrs.videoId).toBe("dQw4w9WgXcQ");
    expect(node.attrs.provider).toBe("youtube");
  });

  it("parses YouTube iframe wrapped in body from DOM", () => {
    const schema = createSchema();
    // Browsers may wrap standalone iframes; test via figure wrapper which is more reliable
    const html = `<figure data-type="video_embed" data-provider="youtube">
      <iframe src="https://www.youtube-nocookie.com/embed/abc123test9" width="640" height="360" data-video-id="abc123test9"></iframe>
    </figure>`;
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("video_embed");
    expect(node.attrs.provider).toBe("youtube");
    expect(node.attrs.videoId).toBe("abc123test9");
    expect(node.attrs.width).toBe(640);
    expect(node.attrs.height).toBe(360);
  });

  it("parses Vimeo iframe from DOM", () => {
    const schema = createSchema();
    const html = '<iframe src="https://player.vimeo.com/video/123456789" width="560" height="315"></iframe>';
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("video_embed");
    expect(node.attrs.provider).toBe("vimeo");
    expect(node.attrs.videoId).toBe("123456789");
  });

  it("parses Bilibili iframe from DOM", () => {
    const schema = createSchema();
    const html = '<iframe src="https://player.bilibili.com/player.html?bvid=BV1234567890" width="560" height="350"></iframe>';
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("video_embed");
    expect(node.attrs.provider).toBe("bilibili");
    expect(node.attrs.videoId).toBe("BV1234567890");
  });

  it("defaults width/height for invalid values in figure", () => {
    const schema = createSchema();
    const html = `<figure data-type="video_embed" data-provider="youtube">
      <iframe src="https://www.youtube-nocookie.com/embed/test123" width="invalid" height="-10" data-video-id="test1234567"></iframe>
    </figure>`;
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.attrs.width).toBe(560);  // NaN from "invalid" falls back to 560
    expect(node.attrs.height).toBe(315); // -10 is not > 0, falls back to 315
  });

  it("does not turn an iframe-less figure into an empty embed", () => {
    // A figure carrying the data-type but no iframe (and no data-video-id)
    // has no derivable video — it must not swallow its content as an empty
    // youtube embed.
    const schema = createSchema();
    const html = '<figure data-type="video_embed"><p>caption only</p></figure>';
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    let embeds = 0;
    doc.descendants((node) => {
      if (node.type.name === "video_embed") embeds++;
    });
    expect(embeds).toBe(0);
    expect(doc.textContent).toContain("caption only");
  });

  it("uses the provider's default height for a Bilibili figure without dimensions", () => {
    const schema = createSchema();
    const html = `<figure data-type="video_embed" data-provider="bilibili">
      <iframe src="https://player.bilibili.com/player.html?bvid=BV1234567890" data-video-id="BV1234567890"></iframe>
    </figure>`;
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    const node = doc.firstChild!;
    expect(node.type.name).toBe("video_embed");
    expect(node.attrs.height).toBe(350);
  });

  it("skips unrecognized iframe src", () => {
    const schema = createSchema();
    const html = '<iframe src="https://example.com/video/123"></iframe>';
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    // Unrecognized iframe should not create a video_embed node
    expect(doc.firstChild!.type.name).not.toBe("video_embed");
  });
});

// ---------------------------------------------------------------------------
// renderHTML
// ---------------------------------------------------------------------------

describe("videoEmbed renderHTML", () => {
  it("serializes YouTube video embed to DOM", () => {
    const { doc, schema } = createVideoDoc({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    const serializer = DOMSerializer.fromSchema(schema);
    expect(() => serializer.serializeFragment(doc.content)).not.toThrow();
  });

  it("renders figure with data-type video_embed", () => {
    const { doc, schema } = createVideoDoc();
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const figure = container.querySelector("figure");
    expect(figure).not.toBeNull();
    expect(figure!.getAttribute("data-type")).toBe("video_embed");
  });

  it("renders data-provider attribute", () => {
    const { doc, schema } = createVideoDoc({ provider: "vimeo" });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const figure = container.querySelector("figure");
    expect(figure!.getAttribute("data-provider")).toBe("vimeo");
  });

  it("renders video-embed class", () => {
    const { doc, schema } = createVideoDoc();
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const figure = container.querySelector("figure");
    expect(figure!.classList.contains("video-embed")).toBe(true);
  });

  it("renders iframe with correct src for YouTube", () => {
    const { doc, schema } = createVideoDoc({ provider: "youtube", videoId: "abc12345678" });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toContain("youtube-nocookie.com/embed/abc12345678");
  });

  it("renders iframe with correct src for Vimeo", () => {
    const { doc, schema } = createVideoDoc({ provider: "vimeo", videoId: "123456" });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("src")).toContain("player.vimeo.com/video/123456");
  });

  it("renders iframe with correct src for Bilibili", () => {
    const { doc, schema } = createVideoDoc({ provider: "bilibili", videoId: "BV1234567890" });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("src")).toContain("player.bilibili.com/player.html?bvid=BV1234567890");
  });

  it("renders iframe with width and height attributes", () => {
    const { doc, schema } = createVideoDoc({ width: 800, height: 450 });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("width")).toBe("800");
    expect(iframe!.getAttribute("height")).toBe("450");
  });

  it("renders iframe with data-video-id attribute", () => {
    const { doc, schema } = createVideoDoc({ videoId: "testId123" });
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("data-video-id")).toBe("testId123");
  });

  it("renders iframe with allowfullscreen", () => {
    const { doc, schema } = createVideoDoc();
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("allowfullscreen")).toBe("true");
  });

  it("handles missing/empty videoId gracefully", () => {
    const { doc, schema } = createVideoDoc({ videoId: "" });
    const serializer = DOMSerializer.fromSchema(schema);
    expect(() => serializer.serializeFragment(doc.content)).not.toThrow();
  });

  it("defaults provider to youtube when using default attrs", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({});
    const doc = schema.nodes.doc.create(null, [node]);
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const figure = container.querySelector("figure");
    expect(figure!.getAttribute("data-provider")).toBe("youtube");
  });
});

// ---------------------------------------------------------------------------
// Paste handler plugin
// ---------------------------------------------------------------------------

describe("videoEmbed other plugin specs", () => {
  it("defines addNodeView", () => {
    expect(videoEmbedExtension.config.addNodeView).toBeDefined();
  });

  it("addNodeView factory creates a VideoEmbedNodeView instance", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: "youtube", videoId: "test123" });
    const factory = videoEmbedExtension.config.addNodeView!.call({
      name: "video_embed",
      editor: {},
      options: {},
      storage: {},
      type: schema.nodes.video_embed,
      parent: undefined,
    } as never);

    // Test with function getPos
    const result = factory({ node, getPos: () => 0, editor: {} as never, HTMLAttributes: {}, decorations: [], innerDecorations: {} as never, extension: {} as never });
    expect(result).toBeDefined();
  });

  it("addNodeView factory handles non-function getPos", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: "youtube", videoId: "test123" });
    const factory = videoEmbedExtension.config.addNodeView!.call({
      name: "video_embed",
      editor: {},
      options: {},
      storage: {},
      type: schema.nodes.video_embed,
      parent: undefined,
    } as never);

    // Test with boolean getPos (Tiptap may pass boolean in some cases)
    const result = factory({ node, getPos: true as never, editor: {} as never, HTMLAttributes: {}, decorations: [], innerDecorations: {} as never, extension: {} as never });
    expect(result).toBeDefined();
  });

  it("defines addKeyboardShortcuts", () => {
    expect(videoEmbedExtension.config.addKeyboardShortcuts).toBeDefined();
  });

  it("addKeyboardShortcuts returns media block shortcuts", () => {
    const shortcuts = videoEmbedExtension.config.addKeyboardShortcuts!.call({
      name: "video_embed",
      editor: {},
      options: {},
      storage: {},
      type: undefined,
      parent: undefined,
    } as never);
    expect(shortcuts).toBeDefined();
    expect(typeof shortcuts).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Uncovered line-specific tests
// ---------------------------------------------------------------------------

describe("videoEmbed parseHTML — iframe with valid provider but no extractable videoId (line 82)", () => {
  it("skips iframe when videoId cannot be extracted from src", () => {
    const schema = createSchema();
    // YouTube iframe with a src that doesn't have a valid embed path
    const html = '<iframe src="https://www.youtube-nocookie.com/embed/" width="560" height="315"></iframe>';
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    const doc = PMDOMParser.fromSchema(schema).parse(dom);
    // Should NOT create a video_embed node because videoId is empty
    expect(doc.firstChild!.type.name).not.toBe("video_embed");
  });
});

describe("videoEmbed addNodeView — safeGetPos fallback (line 123)", () => {
  it("creates safeGetPos that returns undefined for non-function getPos", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: "youtube", videoId: "test123" });
    const factory = videoEmbedExtension.config.addNodeView!.call({
      name: "video_embed",
      editor: {},
      options: {},
      storage: {},
      type: schema.nodes.video_embed,
      parent: undefined,
    } as never);

    // Pass boolean getPos (non-function) — safeGetPos should return undefined
    const result = factory({
      node,
      getPos: false as never,
      editor: {} as never,
      HTMLAttributes: {},
      decorations: [],
      innerDecorations: {} as never,
      extension: {} as never,
    });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: iframe parseHTML width/height defaults (lines 83-89)
// ---------------------------------------------------------------------------

describe("videoEmbed parseHTML — iframe getAttrs branch coverage (lines 83-89)", () => {
  it("exercises the getAttrs function for iframe with valid dimensions", () => {
    // Test directly through parseHTML getAttrs to cover width/height validation branches
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const iframeRule = parseRules![1];
    const getAttrs = iframeRule.getAttrs!;

    // Valid dimensions from Vimeo iframe
    const validEl = document.createElement("iframe");
    validEl.setAttribute("src", "https://player.vimeo.com/video/999888");
    validEl.setAttribute("width", "800");
    validEl.setAttribute("height", "450");
    const result = getAttrs(validEl as never);
    expect(result).not.toBe(false);
    expect((result as Record<string, unknown>).width).toBe(800);
    expect((result as Record<string, unknown>).height).toBe(450);
  });

  it("falls back to 560 for invalid (NaN) width in iframe getAttrs", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![1].getAttrs!;

    const el = document.createElement("iframe");
    el.setAttribute("src", "https://player.vimeo.com/video/999888");
    el.setAttribute("width", "abc");
    el.setAttribute("height", "315");
    const result = getAttrs(el as never) as Record<string, unknown>;
    expect(result).not.toBe(false);
    expect(result.width).toBe(560);  // NaN → fallback
    expect(result.height).toBe(315);
  });

  it("falls back to 315 for negative height in iframe getAttrs", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![1].getAttrs!;

    const el = document.createElement("iframe");
    el.setAttribute("src", "https://player.vimeo.com/video/999888");
    el.setAttribute("width", "640");
    el.setAttribute("height", "-50");
    const result = getAttrs(el as never) as Record<string, unknown>;
    expect(result).not.toBe(false);
    expect(result.width).toBe(640);
    expect(result.height).toBe(315); // -50 not > 0 → fallback
  });

  it("falls back to 560 for zero width in iframe getAttrs", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![1].getAttrs!;

    const el = document.createElement("iframe");
    el.setAttribute("src", "https://player.vimeo.com/video/999888");
    el.setAttribute("width", "0");
    el.setAttribute("height", "400");
    const result = getAttrs(el as never) as Record<string, unknown>;
    expect(result).not.toBe(false);
    expect(result.width).toBe(560); // 0 not > 0 → fallback
    expect(result.height).toBe(400);
  });

  it("uses default 560x315 when iframe has no width/height attrs", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![1].getAttrs!;

    const el = document.createElement("iframe");
    el.setAttribute("src", "https://player.vimeo.com/video/999888");
    // No width/height attrs — parseInt(null ?? "560") = 560
    const result = getAttrs(el as never) as Record<string, unknown>;
    expect(result).not.toBe(false);
    expect(result.width).toBe(560);
    expect(result.height).toBe(315);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: figure parseHTML without iframe child (line 60-62)
// ---------------------------------------------------------------------------

describe("videoEmbed parseHTML — figure getAttrs branch coverage (lines 58-71)", () => {
  it("REFUSES the match when figure has no iframe (no derivable video)", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![0].getAttrs!;

    const figure = document.createElement("figure");
    figure.setAttribute("data-type", "video_embed");
    figure.setAttribute("data-provider", "vimeo");
    // No iframe child → no video ID → rule must decline, not build an
    // empty embed that swallows the figure content.
    expect(getAttrs(figure as never)).toBe(false);
  });

  it("defaults provider to youtube when figure has no data-provider", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![0].getAttrs!;

    const figure = document.createElement("figure");
    figure.setAttribute("data-type", "video_embed");
    // No data-provider
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-video-id", "xyzXYZ12345");
    iframe.setAttribute("width", "400");
    iframe.setAttribute("height", "300");
    figure.appendChild(iframe);

    const result = getAttrs(figure as never) as Record<string, unknown>;
    expect(result.provider).toBe("youtube"); // ?? "youtube" fallback
    expect(result.videoId).toBe("xyzXYZ12345");
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("falls back to 560x315 for invalid width/height in figure iframe", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![0].getAttrs!;

    const figure = document.createElement("figure");
    figure.setAttribute("data-type", "video_embed");
    figure.setAttribute("data-provider", "youtube");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-video-id", "test1234567");
    iframe.setAttribute("width", "invalid");
    iframe.setAttribute("height", "-10");
    figure.appendChild(iframe);

    const result = getAttrs(figure as never) as Record<string, unknown>;
    expect(result.width).toBe(560);   // NaN → fallback
    expect(result.height).toBe(315);  // -10 not > 0 → fallback
  });

  it("a valid src OVERRIDES disagreeing data-* metadata (src is authoritative)", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![0].getAttrs!;

    const figure = document.createElement("figure");
    figure.setAttribute("data-type", "video_embed");
    figure.setAttribute("data-provider", "youtube"); // stale/hostile metadata
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "https://player.vimeo.com/video/123456789");
    iframe.setAttribute("data-video-id", "dQw4w9WgXcQ");
    figure.appendChild(iframe);

    const result = getAttrs(figure as never) as Record<string, unknown>;
    expect(result.provider).toBe("vimeo");
    expect(result.videoId).toBe("123456789");
  });

  it("refuses a garbage declared ID instead of building a broken embed", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![0].getAttrs!;

    const figure = document.createElement("figure");
    figure.setAttribute("data-type", "video_embed");
    figure.setAttribute("data-provider", "youtube");
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-video-id", "short"); // not the 11-char format
    figure.appendChild(iframe);

    expect(getAttrs(figure as never)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: renderHTML null attrs fallback (lines 97-98, 111-112)
// ---------------------------------------------------------------------------

describe("videoEmbed renderHTML — null/undefined attrs fallback (lines 97-98, 111-112)", () => {
  it("falls back to youtube when provider attr is null", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: null, videoId: "abc", width: 560, height: 315 });
    const doc = schema.nodes.doc.create(null, [node]);
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const figure = container.querySelector("figure");
    expect(figure!.getAttribute("data-provider")).toBe("youtube");
  });

  it("falls back to empty string when videoId attr is null", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: "youtube", videoId: null, width: 560, height: 315 });
    const doc = schema.nodes.doc.create(null, [node]);
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("data-video-id")).toBe("");
  });

  it("falls back to 560/315 when width/height attrs are null", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({ provider: "youtube", videoId: "abc", width: null, height: null });
    const doc = schema.nodes.doc.create(null, [node]);
    const serializer = DOMSerializer.fromSchema(schema);
    const fragment = serializer.serializeFragment(doc.content);
    const container = document.createElement("div");
    container.appendChild(fragment);

    const iframe = container.querySelector("iframe");
    expect(iframe!.getAttribute("width")).toBe("560");
    expect(iframe!.getAttribute("height")).toBe("315");
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: paste handler config fallback (lines 158-159)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Branch coverage: paste handler config null fallback (lines 158-159)
// getProviderConfig returns null/undefined → uses ?? 560 / ?? 315 defaults
// ---------------------------------------------------------------------------

describe("videoEmbed parseHTML — iframe with no src attribute (line 78)", () => {
  it("returns false for iframe with no src attribute", () => {
    const parseRules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const getAttrs = parseRules![1].getAttrs!;

    const el = document.createElement("iframe");
    // No src attribute — getAttribute("src") returns null → ?? "" fallback
    el.setAttribute("width", "560");
    el.setAttribute("height", "315");
    const result = getAttrs(el as never);
    expect(result).toBe(false); // Empty src → no provider detected → false
  });
});

describe("renderHTML — unlisted Vimeo privacy hash (audit round)", () => {
  it("carries the hash into the serialized iframe src", () => {
    const schema = createSchema();
    const node = schema.nodes.video_embed.create({
      provider: "vimeo",
      videoId: "123456789",
      privacyHash: "abcDEF123",
    });
    const spec = videoEmbedExtension.config.renderHTML!.call(
      { options: {}, editor: {} } as never,
      { node, HTMLAttributes: {} } as never
    ) as [string, Record<string, unknown>, [string, Record<string, string>]];
    expect(spec[2][1].src).toBe("https://player.vimeo.com/video/123456789?h=abcDEF123");
  });

  it("figure parse without data attrs derives everything from the iframe src", () => {
    const rules = videoEmbedExtension.config.parseHTML!.call({} as never);
    const figureRule = rules[0] as { getAttrs: (el: HTMLElement) => Record<string, unknown> | false };
    const el = document.createElement("figure");
    el.setAttribute("data-type", "video_embed");
    el.innerHTML = '<iframe src="https://player.vimeo.com/video/123456789?h=beef1234"></iframe>';
    const attrs = figureRule.getAttrs(el);
    expect(attrs).toMatchObject({
      provider: "vimeo",
      videoId: "123456789",
      privacyHash: "beef1234",
    });
  });
});
