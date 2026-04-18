/**
 * Tests for genieHandlers — genies.list, genies.read, genies.invoke.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock utils
const mockRespond = vi.fn();
vi.mock("../utils", () => ({
  respond: (response: unknown) => mockRespond(response),
}));

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  handleGeniesList,
  handleGeniesRead,
  handleGeniesInvoke,
} from "../genieHandlers";

describe("genieHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleGeniesList", () => {
    it("returns list of genies from Rust backend", async () => {
      const genies = [
        {
          name: "Summarize",
          path: "/genies/summarize.md",
          source: "global",
          category: "writing",
        },
      ];
      mockInvoke.mockResolvedValue(genies);

      await handleGeniesList("req-1");

      expect(mockInvoke).toHaveBeenCalledWith("list_genies");
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { genies },
      });
    });

    it("returns error on invoke failure", async () => {
      mockInvoke.mockRejectedValue(new Error("Failed to list genies"));

      await handleGeniesList("req-2");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-2",
        success: false,
        error: "Failed to list genies",
      });
    });
  });

  describe("handleGeniesRead", () => {
    it("reads genie content by path", async () => {
      const content = {
        metadata: {
          name: "Summarize",
          description: "Summarize text",
          scope: "selection",
          category: null,
          model: null,
          action: null,
          context: null,
        },
        template: "Summarize: {{selection}}",
      };
      mockInvoke.mockResolvedValue(content);

      await handleGeniesRead("req-3", { path: "/genies/summarize.md" });

      expect(mockInvoke).toHaveBeenCalledWith("read_genie", {
        path: "/genies/summarize.md",
      });
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-3",
        success: true,
        data: content,
      });
    });

    it("returns error for missing path", async () => {
      await handleGeniesRead("req-4", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-4",
        success: false,
        error: expect.stringContaining("Missing or invalid 'path'"),
      });
    });

    it("returns error for non-string path", async () => {
      await handleGeniesRead("req-5", { path: 123 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: expect.stringContaining("Missing or invalid 'path'"),
      });
    });
  });

  describe("handleGeniesInvoke", () => {
    const makeGenieContent = () => ({
      metadata: {
        name: "Test",
        description: "Test genie",
        scope: "selection",
        category: null,
        model: null,
        action: null,
        context: null,
      },
      template: "Test: {{selection}}",
    });

    it("dispatches genie invocation event and reports success when a listener handles it", async () => {
      mockInvoke.mockResolvedValue(makeGenieContent());

      const listener = (e: Event) => {
        (e as CustomEvent).detail.handled = true;
      };
      window.addEventListener("mcp:invoke-genie", listener);

      try {
        await handleGeniesInvoke("req-6", {
          geniePath: "/genies/test.md",
          scope: "selection",
        });

        expect(mockRespond).toHaveBeenCalledWith({
          id: "req-6",
          success: true,
          data: expect.objectContaining({ status: expect.any(String) }),
        });
      } finally {
        window.removeEventListener("mcp:invoke-genie", listener);
      }
    });

    it("reports failure when no listener is mounted", async () => {
      // Regression for #794: fire-and-forget dispatch previously reported
      // success even when the React listener was absent (feature disabled,
      // hook unmounted, or not yet registered).
      mockInvoke.mockResolvedValue(makeGenieContent());

      await handleGeniesInvoke("req-no-listener", {
        geniePath: "/genies/test.md",
        scope: "selection",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-no-listener",
        success: false,
        error: expect.stringContaining("not available"),
      });
    });

    it("returns error for missing geniePath", async () => {
      await handleGeniesInvoke("req-7", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: expect.stringContaining("Missing or invalid 'geniePath'"),
      });
    });

    it("returns error for invalid scope", async () => {
      mockInvoke.mockResolvedValue({
        metadata: { name: "Test", description: "", scope: "selection", category: null, model: null, action: null, context: null },
        template: "",
      });

      await handleGeniesInvoke("req-8", {
        geniePath: "/genies/test.md",
        scope: "invalid",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-8",
        success: false,
        error: expect.stringContaining("Invalid scope"),
      });
    });

    it("defaults scope to selection when not specified", async () => {
      mockInvoke.mockResolvedValue(makeGenieContent());

      const listener = (e: Event) => {
        (e as CustomEvent).detail.handled = true;
      };
      window.addEventListener("mcp:invoke-genie", listener);

      try {
        await handleGeniesInvoke("req-9", { geniePath: "/genies/test.md" });
        expect(mockRespond.mock.calls[0][0].success).toBe(true);
      } finally {
        window.removeEventListener("mcp:invoke-genie", listener);
      }
    });

    it("returns error for non-string geniePath", async () => {
      await handleGeniesInvoke("req-10", { geniePath: 123 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-10",
        success: false,
        error: expect.stringContaining("Missing or invalid 'geniePath'"),
      });
    });
  });

  describe("non-Error thrown values (String(error) branch)", () => {
    it("handleGeniesList handles non-Error thrown value", async () => {
      mockInvoke.mockRejectedValue("raw string error");

      await handleGeniesList("req-str-1");

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-str-1",
        success: false,
        error: "raw string error",
      });
    });

    it("handleGeniesRead handles non-Error thrown value", async () => {
      mockInvoke.mockRejectedValue(42);

      await handleGeniesRead("req-str-2", { path: "/genies/test.md" });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-str-2",
        success: false,
        error: "42",
      });
    });

    it("handleGeniesInvoke handles non-Error thrown value", async () => {
      mockInvoke.mockRejectedValue("invoke error");

      await handleGeniesInvoke("req-str-3", {
        geniePath: "/genies/test.md",
        scope: "selection",
      });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-str-3",
        success: false,
        error: "invoke error",
      });
    });
  });
});
