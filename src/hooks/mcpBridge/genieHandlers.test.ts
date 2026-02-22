/**
 * MCP Bridge — Genie Handler Tests
 *
 * Tests for genies.list, genies.read, and genies.invoke handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleGeniesList,
  handleGeniesRead,
  handleGeniesInvoke,
} from "./genieHandlers";

vi.mock("./utils", () => ({
  respond: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { respond } from "./utils";
import { invoke } from "@tauri-apps/api/core";

describe("genieHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleGeniesList", () => {
    it("returns list of genies from Rust backend", async () => {
      const genies = [
        { name: "Summarize", path: "/genies/summarize.md", source: "global", category: "writing" },
      ];
      vi.mocked(invoke).mockResolvedValue(genies);

      await handleGeniesList("req-1");

      expect(invoke).toHaveBeenCalledWith("list_genies");
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: { genies },
      });
    });

    it("returns error when invoke fails", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("Backend error"));

      await handleGeniesList("req-1");

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "Backend error",
      });
    });
  });

  describe("handleGeniesRead", () => {
    it("returns genie content from Rust backend", async () => {
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
        template: "Summarize: {{content}}",
      };
      vi.mocked(invoke).mockResolvedValue(content);

      await handleGeniesRead("req-1", { path: "/genies/summarize.md" });

      expect(invoke).toHaveBeenCalledWith("read_genie", { path: "/genies/summarize.md" });
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: content,
      });
    });

    it("returns error when path is missing", async () => {
      await handleGeniesRead("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "path is required and must be a string",
      });
    });

    it("returns error when path is not a string", async () => {
      await handleGeniesRead("req-1", { path: 123 });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "path is required and must be a string",
      });
    });
  });

  describe("handleGeniesInvoke", () => {
    it("dispatches genie invocation event", async () => {
      const genieContent = {
        metadata: {
          name: "Test",
          description: "Test genie",
          scope: "selection",
          category: null,
          model: null,
          action: null,
          context: null,
        },
        template: "Do: {{content}}",
      };
      vi.mocked(invoke).mockResolvedValue(genieContent);

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      await handleGeniesInvoke("req-1", { geniePath: "/genies/test.md" });

      expect(invoke).toHaveBeenCalledWith("read_genie", { path: "/genies/test.md" });
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "mcp:invoke-genie" }),
      );
      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({
          status: expect.stringContaining("invocation started"),
        }),
      });

      dispatchSpy.mockRestore();
    });

    it("returns error when geniePath missing", async () => {
      await handleGeniesInvoke("req-1", {});

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: "geniePath is required and must be a string",
      });
    });

    it("returns error for invalid scope", async () => {
      vi.mocked(invoke).mockResolvedValue({
        metadata: { name: "T", description: "", scope: "s", category: null, model: null, action: null, context: null },
        template: "",
      });

      await handleGeniesInvoke("req-1", { geniePath: "/test.md", scope: "invalid" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: false,
        error: expect.stringContaining('Invalid scope "invalid"'),
      });
    });

    it("accepts valid scopes", async () => {
      vi.mocked(invoke).mockResolvedValue({
        metadata: { name: "T", description: "", scope: "document", category: null, model: null, action: null, context: null },
        template: "",
      });

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");

      await handleGeniesInvoke("req-1", { geniePath: "/test.md", scope: "document" });

      expect(respond).toHaveBeenCalledWith({
        id: "req-1",
        success: true,
        data: expect.objectContaining({ status: expect.any(String) }),
      });

      dispatchSpy.mockRestore();
    });
  });
});
