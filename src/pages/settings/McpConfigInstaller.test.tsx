import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { McpConfigInstaller } from "./McpConfigInstaller";
import type { ProviderDiagnostic } from "./mcpConfigMessages";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function diagnostic(over: Partial<ProviderDiagnostic> = {}): ProviderDiagnostic {
  return {
    provider: "claude",
    name: "Claude Code",
    legacy: false,
    configPath: "/Users/someone/.claude.json",
    configExists: true,
    hasVmark: false,
    expectedBinaryPath: null,
    configuredBinaryPath: null,
    binaryExists: false,
    status: "NotConfigured",
    message: "",
    ...over,
  };
}

/** Answer `mcp_config_diagnose` with exactly these rows. */
function withDiagnostics(rows: ProviderDiagnostic[]) {
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "mcp_config_diagnose" ? Promise.resolve(rows) : Promise.resolve(),
  );
}

describe("McpConfigInstaller — a config VMark cannot parse", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("offers Install when the provider merely has no vmark entry", async () => {
    withDiagnostics([diagnostic()]);
    render(<McpConfigInstaller />);
    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("does not offer Install on an unreadable config", async () => {
    withDiagnostics([
      diagnostic({
        status: "ConfigUnreadable",
        message: "Invalid JSON: expected `,` at line 4 column 3",
      }),
    ]);
    render(<McpConfigInstaller />);

    // Recheck proves the row rendered before we assert on an absence.
    expect(await screen.findByRole("button", { name: "Recheck" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair" })).not.toBeInTheDocument();
  });

  it("names the broken file and the reason, so the user can go fix it", async () => {
    withDiagnostics([
      diagnostic({
        status: "ConfigUnreadable",
        message: "Invalid JSON: expected `,` at line 4 column 3",
      }),
    ]);
    render(<McpConfigInstaller />);

    const line = await screen.findByText(/VMark cannot read/);
    expect(line).toHaveTextContent("~/.claude.json");
    expect(line).toHaveTextContent("Invalid JSON: expected `,` at line 4 column 3");
  });

  it("re-runs the diagnosis when Recheck is clicked", async () => {
    withDiagnostics([diagnostic({ status: "ConfigUnreadable", message: "Invalid TOML: x" })]);
    render(<McpConfigInstaller />);

    const recheck = await screen.findByRole("button", { name: "Recheck" });
    const before = invokeMock.mock.calls.filter((c) => c[0] === "mcp_config_diagnose").length;
    recheck.click();

    await waitFor(() => {
      const after = invokeMock.mock.calls.filter((c) => c[0] === "mcp_config_diagnose").length;
      expect(after).toBe(before + 1);
    });
  });
});

// The row renders four statuses; only ConfigUnreadable was exercised above, so
// every button-visibility branch for the other three — and the non-broken
// message styling — went uncovered. These pin what each status offers, which is
// the component's whole job.
describe("McpConfigInstaller — what each status offers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("offers Repair, Update and Remove when the binary path is stale", async () => {
    withDiagnostics([
      diagnostic({
        status: "PathMismatch",
        hasVmark: true,
        binaryExists: true,
        configuredBinaryPath: "/old/vmark-mcp-server",
        expectedBinaryPath: "/new/vmark-mcp-server",
        message: "Binary path outdated - click Repair",
      }),
    ]);
    render(<McpConfigInstaller />);

    expect(await screen.findByRole("button", { name: "Repair" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    // Repair is the fix; offering Install alongside it would be noise.
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("offers Update and Remove — but not Repair — for a healthy install", async () => {
    withDiagnostics([
      diagnostic({
        status: "Valid",
        hasVmark: true,
        binaryExists: true,
        configuredBinaryPath: "/opt/vmark-mcp-server",
        expectedBinaryPath: "/opt/vmark-mcp-server",
      }),
    ]);
    render(<McpConfigInstaller />);

    expect(await screen.findByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows a missing binary as a warning, not as the broken-config error", async () => {
    // BinaryMissing is blocking but the config itself parsed, so it must not
    // render in the error styling reserved for an unreadable file.
    withDiagnostics([
      diagnostic({
        status: "BinaryMissing",
        hasVmark: true,
        configuredBinaryPath: "/gone/vmark-mcp-server",
        message: "Binary not found - reinstall VMark",
      }),
    ]);
    render(<McpConfigInstaller />);

    // The row renders the LOCALIZED text derived from `status`, not the
    // backend's English `message` — that derivation is the point of
    // `diagnosticMessage`, so asserting on the raw message would test nothing.
    const note = await screen.findByText(/binary not found/i);
    expect(note.className).toContain("--warning-color");
    expect(note.className).not.toContain("--error-color");
  });

  it("falls back to the whole path when it has no filename component", async () => {
    // `shortenPath` is `getFileName(path) || path` — a trailing-slash path has
    // no basename, and the row must still show something.
    withDiagnostics([diagnostic({ configPath: "/" })]);
    render(<McpConfigInstaller />);

    expect(await screen.findByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(screen.getByTitle("/")).toBeInTheDocument();
  });

  it("marks a legacy provider and offers only Remove", async () => {
    // A legacy row (discontinued Gemini CLI) is listed only because a vmark
    // entry is still in its config; every other action is refused backend-side.
    withDiagnostics([
      diagnostic({
        provider: "gemini",
        name: "Gemini CLI",
        legacy: true,
        status: "Valid",
        hasVmark: true,
        binaryExists: true,
        configuredBinaryPath: "/opt/vmark-mcp-server",
        expectedBinaryPath: "/opt/vmark-mcp-server",
        configPath: "/Users/someone/.gemini/settings.json",
      }),
    ]);
    render(<McpConfigInstaller />);

    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByText("Discontinued")).toBeInTheDocument();
    expect(screen.getByText(/leftover VMark entry/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair" })).not.toBeInTheDocument();
  });
});

// The Repair and Remove handlers had no coverage at all — every success/failure
// branch sat at zero. They are the paths that write to the user's config, so
// "what does the panel say when the backend refuses?" is worth pinning.
describe("McpConfigInstaller — repair and remove outcomes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  const stale = () =>
    diagnostic({
      status: "PathMismatch",
      hasVmark: true,
      binaryExists: true,
      configuredBinaryPath: "/old/vmark-mcp-server",
      expectedBinaryPath: "/new/vmark-mcp-server",
    });

  it("reports the backend's reason when a repair is refused", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "mcp_config_diagnose") return Promise.resolve([stale()]);
      if (cmd === "mcp_config_install")
        return Promise.resolve({ success: false, message: "Invalid JSON: bad byte", backupPath: null });
      return Promise.resolve();
    });
    render(<McpConfigInstaller />);

    await user.click(await screen.findByRole("button", { name: "Repair" }));

    expect(await screen.findByText(/Invalid JSON: bad byte/)).toBeInTheDocument();
  });

  it("surfaces a thrown command error rather than failing silently", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "mcp_config_diagnose") return Promise.resolve([stale()]);
      if (cmd === "mcp_config_install") return Promise.reject(new Error("keychain locked"));
      return Promise.resolve();
    });
    render(<McpConfigInstaller />);

    await user.click(await screen.findByRole("button", { name: "Repair" }));

    expect(await screen.findByText(/keychain locked/)).toBeInTheDocument();
  });

  it("distinguishes 'removed' from 'there was nothing to remove'", async () => {
    // `changed` exists on the payload precisely so the panel can say which
    // happened without echoing an English sentence from the backend.
    const user = userEvent.setup();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "mcp_config_diagnose") return Promise.resolve([stale()]);
      if (cmd === "mcp_config_uninstall")
        return Promise.resolve({ success: true, changed: false, message: "ignored" });
      return Promise.resolve();
    });
    render(<McpConfigInstaller />);

    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/nothing to remove/i)).toBeInTheDocument();
  });
});

// WI-DP2.6 — a typed CommandError rejection must surface its message, not "[object Object]"
describe("McpConfigInstaller — typed CommandError rejections", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("renders the message of a typed CommandError instead of [object Object]", async () => {
    // `mcp_config_diagnose` returns Result<_, CommandError>, so a rejection is a
    // plain OBJECT. `String(err)` on one yields "[object Object]" — which is what
    // this component used to put on screen the moment the command was typed.
    invokeMock.mockRejectedValue({
      code: "permission-denied",
      message: "cannot read the Claude config",
    });

    render(<McpConfigInstaller />);

    await waitFor(() => {
      expect(screen.getByText(/cannot read the Claude config/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });
});
