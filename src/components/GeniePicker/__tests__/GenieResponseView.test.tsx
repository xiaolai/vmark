/**
 * GenieResponseView — Tests
 *
 * Covers:
 * - Processing mode: thinking state with elapsed time, streaming text with cursor
 * - Preview mode: accept/reject/retry buttons, callback invocations
 * - Error mode: error display, retry/dismiss buttons
 * - Returns null for search/freeform modes
 * - Edge cases: empty responseText, null error, long text, null submittedPrompt
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenieResponseView } from "../GenieResponseView";

// ============================================================================
// Helpers
// ============================================================================

const defaultProps = {
  mode: "preview" as const,
  responseText: "Some result",
  elapsedSeconds: 0,
  error: null,
  submittedPrompt: "Fix grammar",
  onAccept: vi.fn(),
  onReject: vi.fn(),
  onRetry: vi.fn(),
  onCancel: vi.fn(),
};

function renderView(overrides: Partial<typeof defaultProps> = {}) {
  return render(<GenieResponseView {...defaultProps} {...overrides} />);
}

// ============================================================================
// Returns null for non-response modes
// ============================================================================

describe("GenieResponseView — null for non-response modes", () => {
  it("returns null for search mode", () => {
    const { container } = renderView({ mode: "search" });
    expect(container.firstChild).toBeNull();
  });

  it("returns null for freeform mode", () => {
    const { container } = renderView({ mode: "freeform" });
    expect(container.firstChild).toBeNull();
  });
});

// ============================================================================
// Processing mode
// ============================================================================

describe("GenieResponseView — processing mode", () => {
  it("shows thinking state with elapsed time when no responseText", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 5,
    });
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });

  it("shows submitted prompt in dimmed text", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 2,
      submittedPrompt: "Fix grammar",
    });
    expect(screen.getByText("Fix grammar")).toBeInTheDocument();
  });

  it("shows streaming text when responseText is non-empty", () => {
    renderView({
      mode: "processing",
      responseText: "The quick brown fox",
      elapsedSeconds: 3,
    });
    expect(screen.getByText(/The quick brown fox/)).toBeInTheDocument();
  });

  it("shows cancel button during processing", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 1,
    });
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 1,
      onCancel,
    });
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("handles zero elapsed seconds", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 0,
    });
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
    expect(screen.getByText(/0s/)).toBeInTheDocument();
  });
});

// ============================================================================
// Preview mode
// ============================================================================

describe("GenieResponseView — preview mode", () => {
  it("shows response text", () => {
    renderView({ mode: "preview", responseText: "Fixed result" });
    expect(screen.getByText("Fixed result")).toBeInTheDocument();
  });

  it("shows accept button", () => {
    renderView({ mode: "preview" });
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("shows reject button", () => {
    renderView({ mode: "preview" });
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("shows retry button", () => {
    renderView({ mode: "preview" });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onAccept when accept clicked", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();
    renderView({ mode: "preview", onAccept });
    await user.click(screen.getByRole("button", { name: /accept/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("calls onReject when reject clicked", async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    renderView({ mode: "preview", onReject });
    await user.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry when retry clicked", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderView({ mode: "preview", onRetry });
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Error mode
// ============================================================================

describe("GenieResponseView — error mode", () => {
  it("shows error message", () => {
    renderView({ mode: "error", error: "Connection timeout" });
    expect(screen.getByText(/Connection timeout/)).toBeInTheDocument();
  });

  it("shows retry button", () => {
    renderView({ mode: "error", error: "Failed" });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows dismiss button", () => {
    renderView({ mode: "error", error: "Failed" });
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("calls onRetry when retry clicked", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    renderView({ mode: "error", error: "Failed", onRetry });
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onReject (dismiss) when dismiss clicked", async () => {
    const onReject = vi.fn();
    const user = userEvent.setup();
    renderView({ mode: "error", error: "Failed", onReject });
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("GenieResponseView — edge cases", () => {
  it("handles null submittedPrompt in processing mode", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 1,
      submittedPrompt: null,
    });
    // Should not crash, thinking indicator should still show
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });

  it("handles empty responseText in preview mode", () => {
    renderView({ mode: "preview", responseText: "" });
    // Should still show action buttons
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("handles null error in error mode gracefully", () => {
    renderView({ mode: "error", error: null });
    // Should still render error state (with fallback message or empty)
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("handles long response text without crashing", () => {
    const longText = "word ".repeat(1000);
    renderView({ mode: "preview", responseText: longText });
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("handles large elapsed seconds", () => {
    renderView({
      mode: "processing",
      responseText: "",
      elapsedSeconds: 9999,
    });
    expect(screen.getByText(/9999s/)).toBeInTheDocument();
  });
});
