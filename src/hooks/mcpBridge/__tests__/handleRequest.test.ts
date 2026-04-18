/**
 * Tests for the top-level MCP request router in handleRequest.ts.
 *
 * Verifies:
 *   - source-mode guard blocks editor-dependent ops with SOURCE_MODE_ERROR
 *   - source-mode redirect routes source-capable ops to source handlers
 *   - read-only guard blocks write ops with READ_ONLY_ERROR
 *   - each sub-dispatcher is tried in order; the first match wins
 *   - unknown request types respond with a descriptive error
 *   - errors thrown inside a dispatcher are caught and reported
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const {
  mockRespond,
  mockGetEditorStoreState,
  mockIsActiveDocReadOnly,
  mockSourceDocumentGetContent,
  mockSourceOutlineGet,
  mockSourceMetadataGet,
  mockSourceEditorFocus,
  mockDispatchDocument,
  mockDispatchEditor,
  mockDispatchWorkspace,
  mockDispatchInsert,
  mockDispatchAiMcp,
} = vi.hoisted(() => ({
  mockRespond: vi.fn().mockResolvedValue(undefined),
  mockGetEditorStoreState: vi.fn(() => ({ sourceMode: false })),
  mockIsActiveDocReadOnly: vi.fn(() => false),
  mockSourceDocumentGetContent: vi.fn().mockResolvedValue(undefined),
  mockSourceOutlineGet: vi.fn().mockResolvedValue(undefined),
  mockSourceMetadataGet: vi.fn().mockResolvedValue(undefined),
  mockSourceEditorFocus: vi.fn().mockResolvedValue(undefined),
  mockDispatchDocument: vi.fn().mockResolvedValue(false),
  mockDispatchEditor: vi.fn().mockResolvedValue(false),
  mockDispatchWorkspace: vi.fn().mockResolvedValue(false),
  mockDispatchInsert: vi.fn().mockResolvedValue(false),
  mockDispatchAiMcp: vi.fn().mockResolvedValue(false),
}));

vi.mock("../utils", () => ({
  respond: (...args: unknown[]) => mockRespond(...args),
}));

vi.mock("@/stores/editorStore", () => ({
  useEditorStore: { getState: () => mockGetEditorStoreState() },
}));

vi.mock("@/utils/readOnlyGuard", () => ({
  isActiveDocReadOnly: () => mockIsActiveDocReadOnly(),
}));

vi.mock("../sourceHandlers", () => ({
  handleSourceDocumentGetContent: (...args: unknown[]) => mockSourceDocumentGetContent(...args),
  handleSourceOutlineGet: (...args: unknown[]) => mockSourceOutlineGet(...args),
  handleSourceMetadataGet: (...args: unknown[]) => mockSourceMetadataGet(...args),
  handleSourceEditorFocus: (...args: unknown[]) => mockSourceEditorFocus(...args),
}));

vi.mock("../dispatchers/documentDispatch", () => ({
  dispatchDocument: (...args: unknown[]) => mockDispatchDocument(...args),
}));
vi.mock("../dispatchers/editorDispatch", () => ({
  dispatchEditor: (...args: unknown[]) => mockDispatchEditor(...args),
}));
vi.mock("../dispatchers/workspaceDispatch", () => ({
  dispatchWorkspace: (...args: unknown[]) => mockDispatchWorkspace(...args),
}));
vi.mock("../dispatchers/insertDispatch", () => ({
  dispatchInsert: (...args: unknown[]) => mockDispatchInsert(...args),
}));
vi.mock("../dispatchers/aiMcpDispatch", () => ({
  dispatchAiMcp: (...args: unknown[]) => mockDispatchAiMcp(...args),
}));

// --- Import after mocks ---
import { handleRequest } from "../handleRequest";
import { SOURCE_MODE_ERROR } from "../sourceModeGuard";
import { READ_ONLY_ERROR } from "../readOnlyGuard";

const makeEvent = (type: string, args: Record<string, unknown> = {}) => ({
  id: "req-1",
  type,
  args,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEditorStoreState.mockReturnValue({ sourceMode: false });
  mockIsActiveDocReadOnly.mockReturnValue(false);
  mockDispatchDocument.mockResolvedValue(false);
  mockDispatchEditor.mockResolvedValue(false);
  mockDispatchWorkspace.mockResolvedValue(false);
  mockDispatchInsert.mockResolvedValue(false);
  mockDispatchAiMcp.mockResolvedValue(false);
});

describe("handleRequest — guard chain", () => {
  describe("source-mode block guard", () => {
    it("responds with SOURCE_MODE_ERROR for a blocked op in source mode", async () => {
      mockGetEditorStoreState.mockReturnValue({ sourceMode: true });

      await handleRequest(makeEvent("selection.set"));

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: SOURCE_MODE_ERROR,
      });
      // No dispatcher should have been consulted
      expect(mockDispatchDocument).not.toHaveBeenCalled();
      expect(mockDispatchEditor).not.toHaveBeenCalled();
    });

    it("does not block when sourceMode is false", async () => {
      mockGetEditorStoreState.mockReturnValue({ sourceMode: false });
      mockDispatchDocument.mockResolvedValue(true);

      await handleRequest(makeEvent("selection.set"));

      expect(mockDispatchDocument).toHaveBeenCalled();
      expect(mockRespond).not.toHaveBeenCalledWith(
        expect.objectContaining({ error: SOURCE_MODE_ERROR }),
      );
    });

    it("does not block a source-capable op even in source mode", async () => {
      mockGetEditorStoreState.mockReturnValue({ sourceMode: true });

      await handleRequest(makeEvent("document.getContent"));

      // Should route to source handler, NOT respond with SOURCE_MODE_ERROR
      expect(mockSourceDocumentGetContent).toHaveBeenCalledWith("req-1", {});
      expect(mockRespond).not.toHaveBeenCalledWith(
        expect.objectContaining({ error: SOURCE_MODE_ERROR }),
      );
    });
  });

  describe("source-mode redirect", () => {
    it.each([
      ["document.getContent", "mockSourceDocumentGetContent"],
      ["outline.get", "mockSourceOutlineGet"],
      ["metadata.get", "mockSourceMetadataGet"],
      ["editor.focus", "mockSourceEditorFocus"],
    ] as const)("routes %s to the source handler when in source mode", async (type, handlerName) => {
      mockGetEditorStoreState.mockReturnValue({ sourceMode: true });

      await handleRequest(makeEvent(type));

      const handlers: Record<string, ReturnType<typeof vi.fn>> = {
        mockSourceDocumentGetContent,
        mockSourceOutlineGet,
        mockSourceMetadataGet,
        mockSourceEditorFocus,
      };
      expect(handlers[handlerName]).toHaveBeenCalled();
      // Source redirect early-returns — dispatchers must not run
      expect(mockDispatchDocument).not.toHaveBeenCalled();
    });

    it("does NOT redirect source-capable ops when sourceMode is false", async () => {
      mockGetEditorStoreState.mockReturnValue({ sourceMode: false });
      mockDispatchDocument.mockResolvedValue(true);

      await handleRequest(makeEvent("document.getContent"));

      expect(mockSourceDocumentGetContent).not.toHaveBeenCalled();
      expect(mockDispatchDocument).toHaveBeenCalled();
    });
  });

  describe("read-only guard", () => {
    it("responds with READ_ONLY_ERROR for a write op on a read-only doc", async () => {
      mockIsActiveDocReadOnly.mockReturnValue(true);

      await handleRequest(makeEvent("document.setContent"));

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: READ_ONLY_ERROR,
      });
      expect(mockDispatchDocument).not.toHaveBeenCalled();
    });

    it("does not block a read op on a read-only doc", async () => {
      mockIsActiveDocReadOnly.mockReturnValue(true);
      mockDispatchDocument.mockResolvedValue(true);

      await handleRequest(makeEvent("document.getContent"));

      expect(mockDispatchDocument).toHaveBeenCalled();
      expect(mockRespond).not.toHaveBeenCalledWith(
        expect.objectContaining({ error: READ_ONLY_ERROR }),
      );
    });

    it("does not block when doc is writable", async () => {
      mockIsActiveDocReadOnly.mockReturnValue(false);
      mockDispatchDocument.mockResolvedValue(true);

      await handleRequest(makeEvent("document.setContent"));

      expect(mockDispatchDocument).toHaveBeenCalled();
      expect(mockRespond).not.toHaveBeenCalledWith(
        expect.objectContaining({ error: READ_ONLY_ERROR }),
      );
    });
  });
});

describe("handleRequest — dispatcher chain", () => {
  it("stops at the first dispatcher that claims the event", async () => {
    mockDispatchDocument.mockResolvedValue(true);

    await handleRequest(makeEvent("document.getContent"));

    expect(mockDispatchDocument).toHaveBeenCalledTimes(1);
    expect(mockDispatchEditor).not.toHaveBeenCalled();
    expect(mockDispatchWorkspace).not.toHaveBeenCalled();
    expect(mockDispatchInsert).not.toHaveBeenCalled();
    expect(mockDispatchAiMcp).not.toHaveBeenCalled();
  });

  it("tries dispatchers in order document → editor → workspace → insert → aiMcp", async () => {
    // None claim the event
    await handleRequest(makeEvent("unknown.op"));

    // All were called in order; verify with invocation order via mock.invocationCallOrder
    const order = [
      mockDispatchDocument.mock.invocationCallOrder[0],
      mockDispatchEditor.mock.invocationCallOrder[0],
      mockDispatchWorkspace.mock.invocationCallOrder[0],
      mockDispatchInsert.mock.invocationCallOrder[0],
      mockDispatchAiMcp.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("falls back with 'Unknown request type' when no dispatcher claims the event", async () => {
    await handleRequest(makeEvent("unknown.op"));

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "Unknown request type: unknown.op",
    });
  });

  it("routes an editor-domain event past document into editor", async () => {
    mockDispatchEditor.mockResolvedValue(true);

    await handleRequest(makeEvent("format.toggle"));

    expect(mockDispatchDocument).toHaveBeenCalledTimes(1);
    expect(mockDispatchEditor).toHaveBeenCalledTimes(1);
    expect(mockDispatchWorkspace).not.toHaveBeenCalled();
  });

  it("catches an error thrown by a dispatcher and reports it", async () => {
    mockDispatchDocument.mockRejectedValue(new Error("boom"));

    await handleRequest(makeEvent("document.getContent"));

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "boom",
    });
  });

  it("stringifies a non-Error thrown value", async () => {
    mockDispatchDocument.mockRejectedValue("plain string failure");

    await handleRequest(makeEvent("document.getContent"));

    expect(mockRespond).toHaveBeenCalledWith({
      id: "req-1",
      success: false,
      error: "plain string failure",
    });
  });
});
