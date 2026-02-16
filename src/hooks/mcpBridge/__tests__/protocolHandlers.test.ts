/**
 * Tests for protocolHandlers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetCapabilities, handleGetRevision } from "../protocolHandlers";

// Mock respond utility
const mockRespond = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
}));

// Mock revision store
vi.mock("@/stores/revisionStore", () => ({
  useRevisionStore: {
    getState: () => ({
      currentRevision: "rev-test1234",
      lastUpdated: 1234567890,
    }),
  },
}));

// Mock editor store with mutable state for testing both modes
const mockEditorState = { sourceMode: false };
vi.mock("@/stores/editorStore", () => ({
  useEditorStore: {
    getState: () => mockEditorState,
  },
}));

describe("protocolHandlers", () => {
  beforeEach(() => {
    mockRespond.mockClear();
    mockEditorState.sourceMode = false;
  });

  describe("handleGetCapabilities", () => {
    it("returns valid capabilities response", async () => {
      await handleGetCapabilities("test-id");

      expect(mockRespond).toHaveBeenCalledTimes(1);
      const call = mockRespond.mock.calls[0][0];

      expect(call.id).toBe("test-id");
      expect(call.success).toBe(true);
      expect(call.data).toBeDefined();

      const data = call.data;
      expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(data.supportedNodeTypes).toBeInstanceOf(Array);
      expect(data.supportedNodeTypes).toContain("paragraph");
      expect(data.supportedNodeTypes).toContain("heading");
      expect(data.supportedQueryOperators).toBeInstanceOf(Array);
      expect(data.supportedQueryOperators).toContain("type");
      expect(data.supportedQueryOperators).toContain("contains");
    });

    it("includes limits in response", async () => {
      await handleGetCapabilities("test-id");

      const data = mockRespond.mock.calls[0][0].data;
      expect(data.limits).toBeDefined();
      expect(data.limits.maxBatchSize).toBe(100);
      expect(data.limits.maxPayloadBytes).toBeGreaterThan(0);
    });

    it("reports editorMode as wysiwyg when not in source mode", async () => {
      await handleGetCapabilities("test-id");

      const data = mockRespond.mock.calls[0][0].data;
      expect(data.editorMode).toBe("wysiwyg");
    });

    it("reports editorMode as source when in source mode", async () => {
      mockEditorState.sourceMode = true;

      await handleGetCapabilities("test-id");

      const data = mockRespond.mock.calls[0][0].data;
      expect(data.editorMode).toBe("source");
    });

    it("includes features in response", async () => {
      await handleGetCapabilities("test-id");

      const data = mockRespond.mock.calls[0][0].data;
      expect(data.features).toBeDefined();
      expect(data.features.suggestionModeSupported).toBe(true);
      expect(data.features.revisionTracking).toBe(true);
      expect(data.features.idempotency).toBe(true);
    });
  });

  describe("handleGetRevision", () => {
    it("returns current revision info", async () => {
      await handleGetRevision("test-id");

      expect(mockRespond).toHaveBeenCalledTimes(1);
      const call = mockRespond.mock.calls[0][0];

      expect(call.id).toBe("test-id");
      expect(call.success).toBe(true);
      expect(call.data.revision).toBe("rev-test1234");
      expect(call.data.lastUpdated).toBe(1234567890);
    });
  });
});
