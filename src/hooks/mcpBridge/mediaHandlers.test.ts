/**
 * MCP Bridge — Media Handler Tests
 *
 * Tests for insertMedia handler: HTML validation, sanitization,
 * revision checking, and edge cases.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleInsertMedia } from "./mediaHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
  getEditor: vi.fn(),
}));

vi.mock("./revisionTracker", () => ({
  validateBaseRevision: vi.fn(() => null),
  getCurrentRevision: vi.fn(() => "rev-new"),
}));

vi.mock("@/utils/sanitize", () => ({
  sanitizeMediaHtml: vi.fn((html: string) => html),
}));

import { respond, getEditor } from "./utils";
import { validateBaseRevision } from "./revisionTracker";
import { sanitizeMediaHtml } from "@/utils/sanitize";

function createMockEditor() {
  const mockChain = {
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    chain: vi.fn(() => mockChain),
    mockChain,
  };
}

describe("mediaHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateBaseRevision).mockReturnValue(null);
    vi.mocked(sanitizeMediaHtml).mockImplementation((html: string) => html);
  });

  describe("validation", () => {
    it("returns error when mediaHtml is missing", async () => {
      await handleInsertMedia("req-1", { baseRevision: "rev-1" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "mediaHtml is required and must be a string",
      });
    });

    it("returns error when mediaHtml is not a string", async () => {
      await handleInsertMedia("req-1", { baseRevision: "rev-1", mediaHtml: 123 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "mediaHtml is required and must be a string",
      });
    });

    it("returns error for invalid HTML tag", async () => {
      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: "<div>not media</div>",
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "mediaHtml must be a single <video>, <audio>, or <iframe> tag",
      });
    });

    it("returns error for multiple tags", async () => {
      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="a.mp4"></video><script>alert(1)</script>',
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "mediaHtml must be a single <video>, <audio>, or <iframe> tag",
      });
    });

    it("returns error when sanitization rejects HTML", async () => {
      vi.mocked(sanitizeMediaHtml).mockReturnValue("");

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<iframe src="http://malicious.com"></iframe>',
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "mediaHtml was rejected by sanitization (e.g. non-whitelisted iframe)",
      });
    });

    it("returns revision conflict error", async () => {
      vi.mocked(validateBaseRevision).mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });
      vi.mocked(sanitizeMediaHtml).mockReturnValue('<video src="a.mp4"></video>');

      await handleInsertMedia("req-1", {
        baseRevision: "rev-old",
        mediaHtml: '<video src="a.mp4"></video>',
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Revision conflict",
        data: { code: "conflict", currentRevision: "rev-current" },
      });
    });

    it("returns error when no editor", async () => {
      vi.mocked(getEditor).mockReturnValue(null as never);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="a.mp4"></video>',
      });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "No active editor",
      });
    });
  });

  describe("successful insertion", () => {
    it("inserts video tag", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="movie.mp4"></video>',
      });

      expect(editor.mockChain.insertContent).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          inserted: true,
          newRevision: "rev-new",
        }),
      });
    });

    it("inserts audio tag", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<audio src="song.mp3"></audio>',
      });

      expect(editor.mockChain.insertContent).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({ inserted: true }),
      });
    });

    it("inserts iframe tag", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<iframe src="https://youtube.com/embed/abc"></iframe>',
      });

      expect(editor.mockChain.insertContent).toHaveBeenCalled();
    });

    it("inserts self-closing iframe", async () => {
      const editor = createMockEditor();
      vi.mocked(getEditor).mockReturnValue(editor as never);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<iframe src="https://youtube.com/embed/abc" />',
      });

      expect(editor.mockChain.insertContent).toHaveBeenCalled();
    });
  });
});
