/** Tests for blockHandlers — list_blocks, resolve_targets, get_section. */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (before module-under-test import) ─────────────────────────
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();

vi.mock("./utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

vi.mock("@/stores/revisionStore", () => ({
  useRevisionStore: {
    getState: vi.fn(() => ({ getRevision: vi.fn(() => "rev-1") })),
  },
}));

let nodeIdCounter = 0;
vi.mock("./astHandlers", () => ({
  generateNodeId: vi.fn((type: string) => {
    const prefixes: Record<string, string> = { heading: "h", paragraph: "p", codeBlock: "code" };
    const prefix = prefixes[type] || type.substring(0, 4);
    return `${prefix}-${nodeIdCounter++}`;
  }),
  resetNodeIdCounters: vi.fn(() => { nodeIdCounter = 0; }),
  extractText: vi.fn((node: { _text?: string }) => node._text || ""),
  toAstNode: vi.fn((node: { type: { name: string }; _text?: string }) => ({
    id: `${node.type.name}-0`,
    type: node.type.name,
    text: node._text || "",
  })),
  matchesQuery: vi.fn(() => true),
}));

import { handleListBlocks, handleResolveTargets, handleGetSection } from "./blockHandlers";

// ── Helpers ─────────────────────────────────────────────────────────
interface MockNodeSpec {
  type: string;
  text: string;
  attrs?: Record<string, unknown>;
  isBlock?: boolean;
  isTextblock?: boolean;
}

function createMockEditor(nodes: MockNodeSpec[] = []) {
  return {
    state: {
      doc: {
        descendants: vi.fn((cb: Function) => {
          let pos = 0;
          for (const n of nodes) {
            const node = {
              type: { name: n.type },
              attrs: n.attrs || {},
              nodeSize: (n.text.length || 10) + 2,
              isBlock: n.isBlock !== false,
              isTextblock: n.isTextblock !== false,
              _text: n.text,
              descendants: vi.fn((innerCb: Function) => {
                if (n.text) innerCb({ isText: true, text: n.text });
              }),
            };
            const result = cb(node, pos);
            pos += node.nodeSize;
            if (result === false) break;
          }
        }),
        content: { size: 100 },
      },
    },
  };
}

beforeEach(() => {
  mockRespond.mockClear();
  mockGetEditor.mockReset();
  nodeIdCounter = 0;
});

// ── handleListBlocks ────────────────────────────────────────────────

describe("handleListBlocks", () => {
  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleListBlocks("req-1", {});

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "No active editor",
    });
  });

  it("returns blocks from document", async () => {
    const editor = createMockEditor([
      { type: "paragraph", text: "Hello" },
      { type: "paragraph", text: "World" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleListBlocks("req-2", {});

    expect(mockRespond).toHaveBeenCalledTimes(1);
    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.blocks).toHaveLength(2);
    expect(call.data.blocks[0].type).toBe("paragraph");
    expect(call.data.blocks[0].text).toBe("Hello");
    expect(call.data.blocks[1].text).toBe("World");
    expect(call.data.revision).toBe("rev-1");
  });

  it("respects limit parameter", async () => {
    const editor = createMockEditor([
      { type: "paragraph", text: "First" },
      { type: "paragraph", text: "Second" },
      { type: "paragraph", text: "Third" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleListBlocks("req-3", { limit: 1 });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.blocks).toHaveLength(1);
    expect(call.data.hasMore).toBe(true);
    expect(call.data.nextCursor).toBeDefined();
  });

  it("returns empty blocks for no content", async () => {
    const editor = createMockEditor([]);
    mockGetEditor.mockReturnValue(editor);

    await handleListBlocks("req-4", {});

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.blocks).toHaveLength(0);
    expect(call.data.hasMore).toBe(false);
  });
});

// ── handleResolveTargets ────────────────────────────────────────────

describe("handleResolveTargets", () => {
  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleResolveTargets("req-5", { query: { type: "paragraph" } });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-5",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when query missing", async () => {
    const editor = createMockEditor([]);
    mockGetEditor.mockReturnValue(editor);

    await handleResolveTargets("req-6", {});

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-6",
      success: false,
      error: "query is required",
    });
  });

  it("returns candidates for matching query", async () => {
    const editor = createMockEditor([
      { type: "paragraph", text: "some text" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleResolveTargets("req-7", {
      query: { type: "paragraph", contains: "some text" },
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.candidates.length).toBeGreaterThanOrEqual(1);
    expect(call.data.candidates[0]).toHaveProperty("score");
    expect(call.data.candidates[0]).toHaveProperty("nodeId");
    expect(call.data.revision).toBe("rev-1");
  });

  it("marks ambiguous when multiple high scores", async () => {
    const editor = createMockEditor([
      { type: "paragraph", text: "hello" },
      { type: "paragraph", text: "hello" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleResolveTargets("req-8", {
      query: { type: "paragraph", contains: "hello" },
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    // Both have exact match (score=1.0), so isAmbiguous should be true
    expect(call.data.isAmbiguous).toBe(true);
    expect(call.data.candidates).toHaveLength(2);
  });
});

// ── handleGetSection ────────────────────────────────────────────────

describe("handleGetSection", () => {
  it("returns error when no editor", async () => {
    mockGetEditor.mockReturnValue(null);

    await handleGetSection("req-9", { heading: "Introduction" });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-9",
      success: false,
      error: "No active editor",
    });
  });

  it("returns error when heading missing", async () => {
    const editor = createMockEditor([]);
    mockGetEditor.mockReturnValue(editor);

    await handleGetSection("req-10", {});

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-10",
      success: false,
      error: "heading is required",
    });
  });

  it("returns section not found error", async () => {
    const editor = createMockEditor([
      { type: "paragraph", text: "Just a paragraph" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleGetSection("req-11", { heading: "Nonexistent" });

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-11",
      success: false,
      error: "Section not found",
    });
  });

  it("returns section by heading text", async () => {
    const editor = createMockEditor([
      { type: "heading", text: "Introduction", attrs: { level: 2 } },
      { type: "paragraph", text: "Body content" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleGetSection("req-12", { heading: "Introduction" });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.heading.text).toBe("Introduction");
    expect(call.data.heading.level).toBe(2);
    expect(call.data.revision).toBe("rev-1");
    expect(call.data.range).toBeDefined();
    expect(call.data.content).toBeDefined();
  });

  it("returns section by index", async () => {
    const editor = createMockEditor([
      { type: "heading", text: "First H2", attrs: { level: 2 } },
      { type: "paragraph", text: "First body" },
      { type: "heading", text: "Second H2", attrs: { level: 2 } },
      { type: "paragraph", text: "Second body" },
    ]);
    mockGetEditor.mockReturnValue(editor);

    await handleGetSection("req-13", {
      heading: { level: 2, index: 1 },
    });

    const call = mockRespond.mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.data.heading.text).toBe("Second H2");
    expect(call.data.heading.level).toBe(2);
  });
});
