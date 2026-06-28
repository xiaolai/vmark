// MCP bridge path policy — pure boundary decision for bridge file ops.
// Security: prevents a prompt-injected agent from reading/writing outside
// the workspace + open-document tree via workspace.open / save_as.

import { describe, it, expect } from "vitest";
import { resolveBridgePathDecision } from "./mcpBridgePathPolicy";

const NUL = String.fromCharCode(0);

describe("resolveBridgePathDecision", () => {
  it("rejects an empty path", () => {
    const d = resolveBridgePathDecision("", { allowedRoots: ["/ws"] });
    expect(d.allowed).toBe(false);
  });

  it("rejects a relative path", () => {
    const d = resolveBridgePathDecision("notes/x.md", {
      allowedRoots: ["/ws"],
    });
    expect(d.allowed).toBe(false);
  });

  it("rejects a path with a '..' segment even when it literally sits under a root", () => {
    const d = resolveBridgePathDecision("/ws/../etc/passwd", {
      allowedRoots: ["/ws"],
    });
    expect(d.allowed).toBe(false);
    expect(d).toMatchObject({ reason: expect.stringMatching(/\.\./) });
  });

  it("rejects a path containing a null byte even when it sits under a root", () => {
    // A NUL can truncate the path at the C-string boundary in lower fs layers,
    // and the Rust guard only canonicalizes the deepest *existing* ancestor of
    // a new file — so the lexical policy must fail closed here.
    const d = resolveBridgePathDecision(`/ws/note${NUL}.md`, {
      allowedRoots: ["/ws"],
    });
    expect(d.allowed).toBe(false);
    expect(d).toMatchObject({ reason: expect.stringMatching(/null|invalid/i) });
  });

  it("allows an absolute path inside the only root", () => {
    const d = resolveBridgePathDecision("/ws/notes/x.md", {
      allowedRoots: ["/ws"],
    });
    expect(d.allowed).toBe(true);
  });

  it("allows a path equal to a root", () => {
    const d = resolveBridgePathDecision("/ws", { allowedRoots: ["/ws"] });
    expect(d.allowed).toBe(true);
  });

  it("rejects a path outside all roots (the LaunchAgents / dotfile case)", () => {
    const d = resolveBridgePathDecision(
      "/Users/me/Library/LaunchAgents/x.plist",
      { allowedRoots: ["/Users/me/ws"] },
    );
    expect(d.allowed).toBe(false);
  });

  it("rejects a $HOME dotfile when it is outside the open scope", () => {
    const d = resolveBridgePathDecision("/Users/me/.zshenv", {
      allowedRoots: ["/Users/me/ws"],
    });
    expect(d.allowed).toBe(false);
  });

  it("allows when the path matches the second of several roots", () => {
    const d = resolveBridgePathDecision("/b/file.md", {
      allowedRoots: ["/a", "/b", "/c"],
    });
    expect(d.allowed).toBe(true);
  });

  it("rejects when allowedRoots is empty (no workspace, nothing open)", () => {
    const d = resolveBridgePathDecision("/ws/x.md", { allowedRoots: [] });
    expect(d.allowed).toBe(false);
  });

  it("does not allow a sibling whose name prefixes a root (no substring escape)", () => {
    // "/ws-evil" must NOT be treated as inside "/ws".
    const d = resolveBridgePathDecision("/ws-evil/x.md", {
      allowedRoots: ["/ws"],
    });
    expect(d.allowed).toBe(false);
  });

  it("ignores empty-string roots when deciding", () => {
    const d = resolveBridgePathDecision("/ws/x.md", {
      allowedRoots: ["", "/ws"],
    });
    expect(d.allowed).toBe(true);
  });

  it("normalizes backslashes so a Windows-style path matches a root", () => {
    const d = resolveBridgePathDecision("C:\\ws\\notes\\x.md", {
      allowedRoots: ["C:/ws"],
    });
    expect(d.allowed).toBe(true);
  });
});
