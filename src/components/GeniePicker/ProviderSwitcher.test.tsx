/**
 * ProviderSwitcher — Tests
 *
 * Covers:
 * - Rendering available CLI providers (unavailable ones hidden)
 * - Rendering REST providers with API keys or key-optional (keyless hidden)
 * - Active provider check mark
 * - Selecting a provider (activateProvider + onClose)
 * - Settings button (onCloseAll + openSettingsWindow)
 * - Escape key closes switcher (stopPropagation)
 * - Outside click closes switcher
 * - API key masking (maskKey via rendered output)
 * - No CLI section when no available CLI providers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ProviderSwitcher } from "./ProviderSwitcher";
import type { CliProviderInfo, RestProviderConfig, ProviderType } from "@/types/aiGenies";

// ============================================================================
// Mocks
// ============================================================================

const activateProvider = vi.fn();
const detectProviders = vi.fn();

let mockState: {
  activeProvider: ProviderType | null;
  cliProviders: CliProviderInfo[];
  restProviders: RestProviderConfig[];
  detecting: boolean;
  activateProvider: ReturnType<typeof vi.fn>;
  detectProviders: ReturnType<typeof vi.fn>;
};

vi.mock("@/stores/aiStore", () => {
  const store = (selector: (s: typeof mockState) => unknown) => selector(mockState);
  store.getState = () => mockState;

  return {
    useAiProviderStore: store,
    REST_TYPES: new Set(["anthropic", "openai", "google-ai", "ollama-api"]),
    KEY_OPTIONAL_REST: new Set(["ollama-api"]),
  };
});

vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function defaultMockState(): typeof mockState {
  return {
    activeProvider: "claude",
    detecting: false,
    cliProviders: [
      { type: "claude", name: "Claude Code", command: "claude", available: true, path: "/usr/local/bin/claude" },
      { type: "codex", name: "Codex CLI", command: "codex", available: false },
    ],
    restProviders: [
      { type: "anthropic", name: "Anthropic", endpoint: "https://api.anthropic.com", apiKey: "sk-ant-1234567890", model: "claude-sonnet-4-5-20250929" },
      { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com", apiKey: "", model: "gpt-4o" },
      { type: "google-ai", name: "Google AI", endpoint: "", apiKey: "goog-key-abcdefgh", model: "gemini-2.0-flash" },
      { type: "ollama-api", name: "Ollama (API)", endpoint: "http://localhost:11434", apiKey: "", model: "llama3.2" },
    ],
    activateProvider,
    detectProviders,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("ProviderSwitcher", () => {
  const onClose = vi.fn();
  const onCloseAll = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockState = defaultMockState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders only available CLI providers", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.getByText("CLI")).toBeInTheDocument();
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
      // Codex CLI is unavailable — should NOT be rendered
      expect(screen.queryByText("Codex CLI")).toBeNull();
    });

    it("renders only REST providers with API key or key-optional", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.getByText("API")).toBeInTheDocument();
      expect(screen.getByText("Anthropic")).toBeInTheDocument();
      expect(screen.getByText("Google AI")).toBeInTheDocument();
      expect(screen.getByText("Ollama (API)")).toBeInTheDocument();
      // OpenAI has no API key — should NOT be rendered
      expect(screen.queryByText("OpenAI")).toBeNull();
    });

    it("renders Settings... footer button", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.getByText("Settings...")).toBeInTheDocument();
    });

    it("hides CLI section when no available CLI providers", () => {
      mockState.cliProviders = [
        { type: "codex", name: "Codex CLI", command: "codex", available: false },
      ];
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.queryByText("CLI")).toBeNull();
      // API section still present
      expect(screen.getByText("API")).toBeInTheDocument();
    });

    it("hides API section when no REST providers have keys", () => {
      mockState.restProviders = [
        { type: "openai", name: "OpenAI", endpoint: "", apiKey: "", model: "gpt-4o" },
      ];
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.queryByText("API")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Active provider
  // --------------------------------------------------------------------------

  describe("active provider", () => {
    it("shows check mark next to the active CLI provider", () => {
      mockState.activeProvider = "claude";
      render(
        <ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />
      );

      const claudeBtn = screen.getByText("Claude Code").closest("button")!;
      const checkSpan = claudeBtn.querySelector(".provider-switcher-check")!;
      expect(checkSpan.querySelector("svg")).not.toBeNull();
    });

    it("shows check mark next to the active REST provider", () => {
      mockState.activeProvider = "anthropic";
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      const anthropicBtn = screen.getByText("Anthropic").closest("button")!;
      const checkSpan = anthropicBtn.querySelector(".provider-switcher-check")!;
      expect(checkSpan.querySelector("svg")).not.toBeNull();

      // Google AI should not have check
      const googleBtn = screen.getByText("Google AI").closest("button")!;
      const googleCheck = googleBtn.querySelector(".provider-switcher-check")!;
      expect(googleCheck.querySelector("svg")).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // API key masking
  // --------------------------------------------------------------------------

  describe("API key masking", () => {
    it("shows masked key for REST provider with API key", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      // Anthropic has apiKey "sk-ant-1234567890" → should show ••••7890
      expect(screen.getByText("••••7890")).toBeInTheDocument();
    });

    it("does not show key hint for KEY_OPTIONAL_REST providers (ollama-api)", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      // Ollama (API) is in KEY_OPTIONAL_REST — no key hint shown
      const ollamaBtn = screen.getByText("Ollama (API)").closest("button")!;
      expect(ollamaBtn.querySelector(".provider-switcher-key")).toBeNull();
    });

    it("shows masked key for Google AI (has key, not in KEY_OPTIONAL_REST)", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      // Google AI has apiKey "goog-key-abcdefgh" → should show ••••efgh
      expect(screen.getByText("••••efgh")).toBeInTheDocument();
    });

    it("handles REST provider with short API key (< 5 chars)", () => {
      mockState.restProviders = [
        { type: "anthropic", name: "Anthropic", endpoint: "", apiKey: "abc", model: "" },
      ];
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      // maskKey("abc") returns "" → span is empty
      const anthropicBtn = screen.getByText("Anthropic").closest("button")!;
      const keySpan = anthropicBtn.querySelector(".provider-switcher-key");
      expect(keySpan).not.toBeNull();
      expect(keySpan!.textContent).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // Selection
  // --------------------------------------------------------------------------

  describe("selection", () => {
    it("clicking a CLI provider calls activateProvider and onClose", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      fireEvent.click(screen.getByText("Claude Code").closest("button")!);

      expect(activateProvider).toHaveBeenCalledWith("claude");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("clicking a REST provider calls activateProvider and onClose", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      fireEvent.click(screen.getByText("Anthropic").closest("button")!);

      expect(activateProvider).toHaveBeenCalledWith("anthropic");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Settings button
  // --------------------------------------------------------------------------

  describe("settings button", () => {
    it("calls onCloseAll and openSettingsWindow when clicked", async () => {
      const { openSettingsWindow } = await import("@/services/navigation/settingsWindow");

      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      fireEvent.click(screen.getByText("Settings..."));

      expect(onCloseAll).toHaveBeenCalledTimes(1);
      expect(openSettingsWindow).toHaveBeenCalledWith("integrations");
    });
  });

  // --------------------------------------------------------------------------
  // Escape key
  // --------------------------------------------------------------------------

  describe("escape key", () => {
    it("calls onClose when Escape is pressed", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("stops propagation so the parent picker does not close", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      const parentHandler = vi.fn();
      document.addEventListener("keydown", parentHandler);

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);

      document.removeEventListener("keydown", parentHandler);
    });
  });

  // --------------------------------------------------------------------------
  // Outside click
  // --------------------------------------------------------------------------

  describe("outside click", () => {
    it("calls onClose when clicking outside the popover", () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />
        </div>
      );

      act(() => {
        vi.runAllTimers();
      });

      fireEvent.mouseDown(screen.getByTestId("outside"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT close when clicking inside the popover", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      act(() => {
        vi.runAllTimers();
      });

      fireEvent.mouseDown(screen.getByText("API"));

      expect(onClose).not.toHaveBeenCalled();
    });

    it("does NOT close on the opening click (deferred listener)", () => {
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />
        </div>
      );

      // Click before timer fires — listener not yet registered
      fireEvent.mouseDown(screen.getByTestId("outside"));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  describe("cleanup", () => {
    it("removes event listeners on unmount", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const removeSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = render(
        <ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />
      );

      act(() => {
        vi.runAllTimers();
      });

      unmount();

      const removedTypes = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedTypes).toContain("mousedown");
      expect(removedTypes).toContain("keydown");

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("hides CLI section when all CLI providers are unavailable", () => {
      mockState.cliProviders = [
        { type: "claude", name: "Claude Code", command: "claude", available: false },
        { type: "codex", name: "Codex CLI", command: "codex", available: false },
      ];
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      // No available CLIs → CLI section hidden
      expect(screen.queryByText("CLI")).toBeNull();
    });

    it("handles no active provider (null)", () => {
      mockState.activeProvider = null;
      const { container } = render(
        <ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />
      );

      // No check marks should be shown
      const checkSpans = container.querySelectorAll(".provider-switcher-check svg");
      expect(checkSpans).toHaveLength(0);
    });

    it("triggers detectProviders on mount when CLI list is empty", () => {
      mockState.cliProviders = [];
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(detectProviders).toHaveBeenCalledTimes(1);
    });

    it("does not re-detect when CLI providers already populated", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(detectProviders).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility (A4)
  // --------------------------------------------------------------------------

  describe("accessibility", () => {
    it("exposes a menu with menuitemradio items reflecting the active provider", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      expect(screen.getByRole("menu")).toBeInTheDocument();
      // Active provider is "claude" — its item is checked.
      const claudeItem = screen.getByRole("menuitemradio", { name: /Claude Code/ });
      expect(claudeItem).toHaveAttribute("aria-checked", "true");
      const anthropicItem = screen.getByRole("menuitemradio", { name: /Anthropic/ });
      expect(anthropicItem).toHaveAttribute("aria-checked", "false");
      // Settings footer is a plain menuitem.
      expect(screen.getByRole("menuitem", { name: /Settings/ })).toBeInTheDocument();
    });

    it("moves focus onto the active item when the menu opens", () => {
      render(<ProviderSwitcher onClose={onClose} onCloseAll={onCloseAll} />);

      const claudeItem = screen.getByRole("menuitemradio", { name: /Claude Code/ });
      expect(document.activeElement).toBe(claudeItem);
    });
  });
});
