/**
 * Tests for `utils/clientIdentity.ts`.
 *
 * Two functions, deliberately kept apart:
 *
 * - `readClientToken` reads a credential VMark issued and will VERIFY. Its
 *   contract is "present, non-blank, or nothing".
 * - `detectClientIdentity` GUESSES a display label. Its branches moved here
 *   from `cli.ts`, where they were unreachable by any test — which is how a
 *   heuristic ended up backing an authorization decision unnoticed
 *   (audit 20260728 §2.1).
 */

import { describe, it, expect } from "vitest";
import {
  CLIENT_TOKEN_ENV,
  detectClientIdentity,
  readClientToken,
} from "../../../src/utils/clientIdentity.js";

describe("readClientToken", () => {
  it("returns the credential VMark wrote into this client MCP config", () => {
    expect(readClientToken({ [CLIENT_TOKEN_ENV]: "cred-codex" })).toBe(
      "cred-codex",
    );
  });

  it("trims surrounding whitespace, matching the Rust reader", () => {
    expect(readClientToken({ [CLIENT_TOKEN_ENV]: "  cred-codex\n" })).toBe(
      "cred-codex",
    );
  });

  /**
   * The migration state: every install predating this mechanism has no `env`
   * block. That must be silent and normal — the sidecar still connects with
   * the shared bridge token and is simply not identified.
   */
  it("returns undefined when no credential is configured", () => {
    expect(readClientToken({})).toBeUndefined();
  });

  it("treats a blank credential as absent rather than presenting an empty one", () => {
    expect(readClientToken({ [CLIENT_TOKEN_ENV]: "" })).toBeUndefined();
    expect(readClientToken({ [CLIENT_TOKEN_ENV]: "   " })).toBeUndefined();
  });

  it("reads process.env by default", () => {
    const previous = process.env[CLIENT_TOKEN_ENV];
    process.env[CLIENT_TOKEN_ENV] = "from-process-env";
    try {
      expect(readClientToken()).toBe("from-process-env");
    } finally {
      if (previous === undefined) {
        delete process.env[CLIENT_TOKEN_ENV];
      } else {
        process.env[CLIENT_TOKEN_ENV] = previous;
      }
    }
  });
});

describe("detectClientIdentity", () => {
  it("recognises Claude Code from its entrypoint variable", () => {
    const identity = detectClientIdentity({
      env: { CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_VERSION: "2.0.1" },
      parentProcess: "node",
      pid: 42,
    });
    expect(identity).toEqual({
      name: "claude-code",
      version: "2.0.1",
      pid: 42,
      parentProcess: "node",
    });
  });

  it("recognises Claude Code from the parent process name", () => {
    expect(
      detectClientIdentity({ env: {}, parentProcess: "claude", pid: 1 }).name,
    ).toBe("claude-code");
  });

  it("recognises Codex CLI from CODEX_HOME and from the parent name", () => {
    expect(
      detectClientIdentity({
        env: { CODEX_HOME: "/home/x/.codex" },
        parentProcess: "node",
        pid: 1,
      }).name,
    ).toBe("codex-cli");
    expect(
      detectClientIdentity({ env: {}, parentProcess: "codex", pid: 1 }).name,
    ).toBe("codex-cli");
  });

  it("carries the Codex version when the environment supplies one", () => {
    expect(
      detectClientIdentity({
        env: { CODEX_HOME: "/x", CODEX_VERSION: "9.9" },
        parentProcess: "node",
        pid: 1,
      }).version,
    ).toBe("9.9");
  });

  it("recognises Cursor and Windsurf case-insensitively", () => {
    expect(
      detectClientIdentity({ env: {}, parentProcess: "Cursor Helper", pid: 1 })
        .name,
    ).toBe("cursor");
    expect(
      detectClientIdentity({ env: {}, parentProcess: "Windsurf", pid: 1 }).name,
    ).toBe("windsurf");
  });

  it('falls back to the parent process name, then to "unknown"', () => {
    expect(
      detectClientIdentity({ env: {}, parentProcess: "some-editor", pid: 1 })
        .name,
    ).toBe("some-editor");
    expect(
      detectClientIdentity({ env: {}, parentProcess: undefined, pid: 1 }).name,
    ).toBe("unknown");
  });

  /**
   * The reason this is a label and not a credential: the detection is a
   * substring match on a name the caller controls. A wrapper script called
   * `claude-wrapper` reports itself as Claude Code with nobody attacking
   * anything — which is exactly why authorization must not read it.
   */
  it('is a guess: any parent name containing "claude" reports as Claude Code', () => {
    expect(
      detectClientIdentity({
        env: {},
        parentProcess: "my-claude-wrapper",
        pid: 1,
      }).name,
    ).toBe("claude-code");
  });

  it("defaults its inputs to the real process", () => {
    expect(detectClientIdentity().pid).toBe(process.pid);
  });
});
