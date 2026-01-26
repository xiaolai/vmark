/**
 * AI Agent Hook Tests
 *
 * Tests for the useAIAgent hook that manages Claude Agent SDK integration.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAIAgent } from "./useAIAgent";

// Mock Tauri APIs (already set up in setup.ts, but we override here for specific tests)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
  randomUUID: vi.fn(() => `test-uuid-${Date.now()}`),
});

const mockInvoke = invoke as Mock;
const mockListen = listen as Mock;

describe("useAIAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for agent_status
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "agent_status") {
        return Promise.resolve({
          running: false,
          claude_installed: true,
          claude_version: "1.0.0",
          has_api_key: true,
        });
      }
      return Promise.resolve({});
    });

    // Default mock for listen - return unlisten function
    mockListen.mockImplementation(() => Promise.resolve(() => {}));
  });

  describe("Initial state", () => {
    it("has correct initial state before refresh", () => {
      const { result } = renderHook(() => useAIAgent());

      expect(result.current.running).toBe(false);
      expect(result.current.claudeInstalled).toBe(false);
      expect(result.current.claudeVersion).toBeNull();
      expect(result.current.hasApiKey).toBe(false);
      expect(result.current.isProcessing).toBe(false);
      expect(result.current.partialContent).toBe("");
      expect(result.current.error).toBeNull();
      expect(result.current.currentRequestId).toBeNull();
    });

    it("refreshes status on mount", async () => {
      const { result } = renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("agent_status");
      });

      await waitFor(() => {
        expect(result.current.claudeInstalled).toBe(true);
        expect(result.current.claudeVersion).toBe("1.0.0");
        expect(result.current.hasApiKey).toBe(true);
      });
    });
  });

  describe("refresh", () => {
    it("updates state from agent_status", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: true,
            claude_installed: true,
            claude_version: "2.0.0",
            has_api_key: false,
          });
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(result.current.running).toBe(true);
        expect(result.current.claudeVersion).toBe("2.0.0");
        expect(result.current.hasApiKey).toBe(false);
      });
    });

    it("sets error on failure", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_status") {
          return Promise.reject(new Error("Connection failed"));
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(result.current.error).toBe("Connection failed");
      });
    });
  });

  describe("start", () => {
    it("calls agent_start and updates state", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_start") {
          return Promise.resolve({
            running: true,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: false,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      await act(async () => {
        await result.current.start();
      });

      expect(mockInvoke).toHaveBeenCalledWith("agent_start");
      expect(result.current.running).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("sets error on start failure", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_start") {
          return Promise.reject(new Error("Failed to start"));
        }
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: false,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      await act(async () => {
        await expect(result.current.start()).rejects.toThrow("Failed to start");
      });

      expect(result.current.error).toBe("Failed to start");
    });
  });

  describe("stop", () => {
    it("calls agent_stop and updates state", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_stop") {
          return Promise.resolve({
            running: false,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: true,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      // Wait for initial status
      await waitFor(() => {
        expect(result.current.running).toBe(true);
      });

      await act(async () => {
        await result.current.stop();
      });

      expect(mockInvoke).toHaveBeenCalledWith("agent_stop");
      expect(result.current.running).toBe(false);
    });
  });

  describe("cancel", () => {
    it("sends cancel request and resets processing state", async () => {
      // Set up a scenario where we're processing
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: true,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        if (cmd === "agent_query") {
          // Simulate a long-running query that doesn't resolve immediately
          return new Promise(() => {});
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      // Wait for initial refresh
      await waitFor(() => {
        expect(result.current.running).toBe(true);
      });

      // Start a query (don't await - it's intentionally long-running)
      act(() => {
        result.current.customPrompt("Test prompt").catch(() => {});
      });

      // Wait for processing state
      await waitFor(() => {
        expect(result.current.isProcessing).toBe(true);
        expect(result.current.currentRequestId).not.toBeNull();
      });

      // Cancel
      act(() => {
        result.current.cancel();
      });

      expect(result.current.isProcessing).toBe(false);
      expect(result.current.currentRequestId).toBeNull();
    });

    it("does nothing when not processing", () => {
      const { result } = renderHook(() => useAIAgent());

      act(() => {
        result.current.cancel();
      });

      // Should not throw or change state
      expect(result.current.isProcessing).toBe(false);
    });
  });

  describe("AI Operations", () => {
    describe("improveWriting", () => {
      it("sends query with style instructions", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            // Don't resolve - we just want to check the request
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.improveWriting("Some text", "formal").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string; options: { maxTurns: number } };
        expect(request.prompt).toContain("formal and professional");
        expect(request.prompt).toContain("Some text");
        expect(request.options.maxTurns).toBe(1);
      });
    });

    describe("translate", () => {
      it("sends query with target language", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.translate("Hello world", "Spanish").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string };
        expect(request.prompt).toContain("Spanish");
        expect(request.prompt).toContain("Hello world");
      });
    });

    describe("summarize", () => {
      it("sends query with length instructions", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.summarize("Long text to summarize", "brief").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string };
        expect(request.prompt).toContain("1-2 sentences");
        expect(request.prompt).toContain("Long text to summarize");
      });
    });

    describe("expand", () => {
      it("sends query with focus instruction", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.expand("Short text", "technical details").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string };
        expect(request.prompt).toContain("technical details");
        expect(request.prompt).toContain("Short text");
      });
    });

    describe("customPrompt", () => {
      it("sends custom prompt with optional text", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.customPrompt("Make this better", "some text").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string };
        expect(request.prompt).toContain("Make this better");
        expect(request.prompt).toContain("some text");
      });

      it("sends prompt without text when not provided", async () => {
        let capturedRequest: unknown = null;

        mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
          if (cmd === "agent_status") {
            return Promise.resolve({
              running: true,
              claude_installed: true,
              claude_version: "1.0.0",
              has_api_key: true,
            });
          }
          if (cmd === "agent_query") {
            capturedRequest = args?.request;
            return new Promise(() => {});
          }
          return Promise.resolve({});
        });

        const { result } = renderHook(() => useAIAgent());

        await waitFor(() => {
          expect(result.current.running).toBe(true);
        });

        act(() => {
          result.current.customPrompt("Just a question").catch(() => {});
        });

        await waitFor(() => {
          expect(capturedRequest).not.toBeNull();
        });

        const request = capturedRequest as { prompt: string };
        expect(request.prompt).toBe("Just a question");
      });
    });
  });

  describe("Event handling", () => {
    it("sets up event listeners on mount", async () => {
      renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith("agent:response", expect.any(Function));
        expect(mockListen).toHaveBeenCalledWith("agent:started", expect.any(Function));
        expect(mockListen).toHaveBeenCalledWith("agent:stopped", expect.any(Function));
      });
    });

    it("cleans up listeners on unmount", async () => {
      const unlistenMock = vi.fn();
      mockListen.mockImplementation(() => Promise.resolve(unlistenMock));

      const { unmount } = renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });

      unmount();

      // Give time for cleanup
      await waitFor(() => {
        expect(unlistenMock).toHaveBeenCalled();
      });
    });
  });

  describe("Default tool allowlist", () => {
    it("includes VMark MCP tools in default options", async () => {
      let capturedRequest: unknown = null;

      mockInvoke.mockImplementation((cmd: string, args?: { request: unknown }) => {
        if (cmd === "agent_status") {
          return Promise.resolve({
            running: true,
            claude_installed: true,
            claude_version: "1.0.0",
            has_api_key: true,
          });
        }
        if (cmd === "agent_query") {
          capturedRequest = args?.request;
          return new Promise(() => {});
        }
        return Promise.resolve({});
      });

      const { result } = renderHook(() => useAIAgent());

      await waitFor(() => {
        expect(result.current.running).toBe(true);
      });

      act(() => {
        result.current.customPrompt("Test").catch(() => {});
      });

      await waitFor(() => {
        expect(capturedRequest).not.toBeNull();
      });

      const request = capturedRequest as { options: { allowedTools: string[] } };
      expect(request.options.allowedTools).toContain("mcp__vmark__document_get_content");
      expect(request.options.allowedTools).toContain("mcp__vmark__selection_get");
      expect(request.options.allowedTools).toContain("mcp__vmark__selection_replace");
    });
  });
});
