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
        error: "path is required and must be a string",
      });
    });

    it("returns error for non-string path", async () => {
      await handleGeniesRead("req-5", { path: 123 });

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-5",
        success: false,
        error: "path is required and must be a string",
      });
    });
  });

  describe("handleGeniesInvoke", () => {
    it("dispatches genie invocation event", async () => {
      const genie = {
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
      };
      mockInvoke.mockResolvedValue(genie);

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      await handleGeniesInvoke("req-6", {
        geniePath: "/genies/test.md",
        scope: "selection",
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "mcp:invoke-genie",
        })
      );
      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-6",
        success: true,
        data: expect.objectContaining({ status: expect.any(String) }),
      });

      dispatchSpy.mockRestore();
    });

    it("returns error for missing geniePath", async () => {
      await handleGeniesInvoke("req-7", {});

      expect(mockRespond).toHaveBeenCalledWith({
        id: "req-7",
        success: false,
        error: "geniePath is required and must be a string",
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
      mockInvoke.mockResolvedValue({
        metadata: {
          name: "Test",
          description: "",
          scope: "selection",
          category: null,
          model: null,
          action: null,
          context: null,
        },
        template: "",
      });

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      await handleGeniesInvoke("req-9", { geniePath: "/genies/test.md" });

      expect(mockRespond.mock.calls[0][0].success).toBe(true);

      dispatchSpy.mockRestore();
    });
  });
});
