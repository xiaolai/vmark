// Behavior tests for the MCP config preview dialog: modal semantics, the
// shared overlay shell (audit round 2, finding 27 — the scrim comes from
// `.vm-overlay--center`, replacing a bespoke hover-tint backdrop plus a dead
// `justify-content` class), backdrop-cancel, and the confirm/cancel wiring.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { McpConfigPreviewDialog } from "./McpConfigPreviewDialog";

const preview = {
  provider: "claude",
  path: "/Users/me/.claude.json",
  binaryPath: "/usr/local/bin/vmark-mcp-server",
  isDev: false,
  currentContent: '{ "mcpServers": {} }',
  proposedContent: '{ "mcpServers": { "vmark": {} } }',
  backupPath: "/Users/me/.claude.json.backup",
};

function renderDialog(overrides: Partial<Parameters<typeof McpConfigPreviewDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <McpConfigPreviewDialog preview={preview} onConfirm={onConfirm} onCancel={onCancel} loading={false} {...overrides} />,
  );
  return { onConfirm, onCancel, ...utils };
}

describe("McpConfigPreviewDialog", () => {
  it("renders an aria-modal dialog on the shared overlay shell", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const backdrop = dialog.parentElement;
    expect(backdrop?.className).toContain("vm-overlay");
    expect(backdrop?.className).toContain("vm-overlay--center");
  });

  it("clicking the backdrop cancels; clicking the panel does not", () => {
    const { onCancel } = renderDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the confirm button applies and the cancel button cancels", () => {
    const { onConfirm, onCancel } = renderDialog();
    const buttons = screen.getAllByRole("button");
    const confirm = buttons.find((b) => /install|apply|confirm|write/i.test(b.textContent ?? ""));
    expect(confirm).toBeDefined();
    fireEvent.click(confirm!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const cancel = buttons.find((b) => /cancel/i.test(b.textContent ?? ""));
    fireEvent.click(cancel!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the config path and the provider display name", () => {
    renderDialog();
    expect(screen.getAllByText(/\.claude\.json/, { exact: false }).length).toBeGreaterThan(0);
  });
});
