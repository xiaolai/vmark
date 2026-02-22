/**
 * Tests for mediaHandlers — insertMedia.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
const mockGetEditor = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
  getEditor: () => mockGetEditor(),
}));

// Mock revision tracker
const mockValidateBaseRevision = vi.fn();
const mockGetCurrentRevision = vi.fn().mockReturnValue("rev-new");
vi.mock("../revisionTracker", () => ({
  validateBaseRevision: (...args: unknown[]) =>
    mockValidateBaseRevision(...args),
  getCurrentRevision: () => mockGetCurrentRevision(),
}));

// Mock sanitizer
vi.mock("@/utils/sanitize", () => ({
  sanitizeMediaHtml: (html: string) => {
    // Simple mock: reject iframes from non-whitelisted domains
    if (html.includes("evil.com")) return "";
    return html;
  },
}));

import { handleInsertMedia } from "../mediaHandlers";

function createMockEditor() {
  const chainMethods = {
    focus: vi.fn().mockReturnThis(),
    insertContent: vi.fn().mockReturnThis(),
    run: vi.fn(),
  };
  return {
    chain: vi.fn().mockReturnValue(chainMethods),
    _chainMethods: chainMethods,
  };
}

describe("mediaHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateBaseRevision.mockReturnValue(null);
  });

  describe("handleInsertMedia", () => {
    it("inserts valid video HTML", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMedia("req-1", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="test.mp4" controls></video>',
      });

      expect(editor._chainMethods.insertContent).toHaveBeenCalled();
      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(true);
      expect(call.data.inserted).toBe(true);
    });

    it("inserts valid audio HTML", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMedia("req-2", {
        baseRevision: "rev-1",
        mediaHtml: '<audio src="test.mp3" controls></audio>',
      });

      expect(mockRespond.mock.calls[0][0].success).toBe(true);
    });

    it("inserts valid iframe HTML", async () => {
      const editor = createMockEditor();
      mockGetEditor.mockReturnValue(editor);

      await handleInsertMedia("req-3", {
        baseRevision: "rev-1",
        mediaHtml: '<iframe src="https://youtube.com/embed/abc"></iframe>',
      });

      expect(mockRespond.mock.calls[0][0].success).toBe(true);
    });

    it("returns error for missing mediaHtml", async () => {
      await handleInsertMedia("req-4", { baseRevision: "rev-1" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: "mediaHtml is required and must be a string",
      });
    });

    it("returns error for non-string mediaHtml", async () => {
      await handleInsertMedia("req-5", {
        baseRevision: "rev-1",
        mediaHtml: 123,
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "mediaHtml is required and must be a string",
      });
    });

    it("rejects invalid HTML tags", async () => {
      await handleInsertMedia("req-6", {
        baseRevision: "rev-1",
        mediaHtml: "<script>alert(1)</script>",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: false,
        error: "mediaHtml must be a single <video>, <audio>, or <iframe> tag",
      });
    });

    it("rejects multiple tags", async () => {
      await handleInsertMedia("req-7", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="a.mp4"></video><script>alert(1)</script>',
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "mediaHtml must be a single <video>, <audio>, or <iframe> tag",
      });
    });

    it("rejects non-whitelisted iframe via sanitizer", async () => {
      await handleInsertMedia("req-8", {
        baseRevision: "rev-1",
        mediaHtml: '<iframe src="https://evil.com/embed"></iframe>',
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: expect.stringContaining("rejected by sanitization"),
      });
    });

    it("returns revision conflict error", async () => {
      mockValidateBaseRevision.mockReturnValue({
        error: "Revision conflict",
        currentRevision: "rev-current",
      });

      await handleInsertMedia("req-9", {
        baseRevision: "rev-old",
        mediaHtml: '<video src="test.mp4" controls></video>',
      });

      const call = mockRespond.mock.calls[0][0];
      expect(call.success).toBe(false);
      expect(call.data.code).toBe("conflict");
    });

    it("returns error when no editor", async () => {
      mockGetEditor.mockReturnValue(null);

      await handleInsertMedia("req-10", {
        baseRevision: "rev-1",
        mediaHtml: '<video src="test.mp4" controls></video>',
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: "No active editor",
      });
    });
  });
});
