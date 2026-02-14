import { describe, it, expect } from "vitest";
import { formatClientName, formatMcpTooltip } from "../StatusBarRight";

describe("formatClientName", () => {
  it.each([
    { input: "claude-code", expected: "Claude Code" },
    { input: "codex-cli", expected: "Codex CLI" },
    { input: "cursor", expected: "Cursor" },
    { input: "windsurf", expected: "Windsurf" },
    { input: "my-ai-tool", expected: "My AI Tool" },
    { input: "unknown", expected: "Unknown" },
  ])("formats $input → $expected", ({ input, expected }) => {
    expect(formatClientName(input)).toBe(expected);
  });
});

describe("formatMcpTooltip", () => {
  it("shows error message", () => {
    expect(formatMcpTooltip(false, false, "Connection refused", [])).toBe(
      "MCP error: Connection refused"
    );
  });

  it("shows loading state", () => {
    expect(formatMcpTooltip(false, true, null, [])).toBe("MCP starting...");
  });

  it("shows stopped state", () => {
    expect(formatMcpTooltip(false, false, null, [])).toBe(
      "MCP stopped · Click to start"
    );
  });

  it("shows ready when running with no clients", () => {
    expect(formatMcpTooltip(true, false, null, [])).toBe(
      "MCP ready · No AI connected"
    );
  });

  it("shows single connected client with version", () => {
    const clients = [{ name: "claude-code", version: "1.2.0" }];
    expect(formatMcpTooltip(true, false, null, clients)).toBe(
      "Connected: Claude Code v1.2.0"
    );
  });

  it("shows single connected client without version", () => {
    const clients = [{ name: "cursor", version: null }];
    expect(formatMcpTooltip(true, false, null, clients)).toBe(
      "Connected: Cursor"
    );
  });

  it("shows multiple connected clients", () => {
    const clients = [
      { name: "claude-code", version: "1.2.0" },
      { name: "codex-cli", version: "0.9.0" },
    ];
    expect(formatMcpTooltip(true, false, null, clients)).toBe(
      "Connected: Claude Code v1.2.0, Codex CLI v0.9.0"
    );
  });

  it("error takes priority over loading", () => {
    expect(formatMcpTooltip(true, true, "Something broke", [])).toBe(
      "MCP error: Something broke"
    );
  });
});
