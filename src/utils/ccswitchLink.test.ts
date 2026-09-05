// @vitest-environment node
// CC-Switch deep-link builder (issue #1008; wire format corrected in #1361).

import { describe, it, expect } from "vitest";
import { buildCcSwitchImportLink } from "./ccswitchLink";

/** Parse a ccswitch://v1/import link's query into a map. */
function parseQuery(link: string): Record<string, string> {
  const q = link.slice(link.indexOf("?") + 1);
  const out: Record<string, string> = {};
  for (const pair of q.split("&")) {
    const i = pair.indexOf("=");
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

/** The `config` param the way CC-Switch reads it: Base64-decoded, then JSON. */
function decodeConfig(link: string): unknown {
  const b64 = parseQuery(link).config;
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe("buildCcSwitchImportLink", () => {
  it("uses the ccswitch://v1/import scheme and path", () => {
    expect(buildCcSwitchImportLink("/usr/local/bin/vmark-mcp-server")).toMatch(
      /^ccswitch:\/\/v1\/import\?/,
    );
  });

  it("sets resource=mcp and name=vmark", () => {
    const q = parseQuery(buildCcSwitchImportLink("/bin/x"));
    expect(q.resource).toBe("mcp");
    expect(q.name).toBe("vmark");
  });

  it("defaults apps to claude,codex,grok,opencode (comma-separated, literal)", () => {
    const link = buildCcSwitchImportLink("/bin/x");
    expect(link).toContain("apps=claude,codex,grok,opencode");
  });

  it("only names app ids CC-Switch's parser accepts", () => {
    // CC-Switch rejects the ENTIRE link if any one id is unknown, so a typo or
    // a VMark-side provider id smuggled in here breaks the hand-off silently
    // from VMark's side. This is the id set its `parse_mcp_deeplink` matches.
    const accepted = new Set([
      "claude",
      "codex",
      "gemini",
      "grokbuild",
      "grok",
      "opencode",
      "openclaw",
      "hermes",
    ]);
    const q = parseQuery(buildCcSwitchImportLink("/bin/x"));
    for (const app of q.apps.split(",")) {
      expect(accepted, `CC-Switch would reject "${app}"`).toContain(app);
    }
    // VMark's own provider id for Antigravity has no CC-Switch counterpart.
    expect(q.apps).not.toContain("antigravity");
  });

  it("honors a custom apps list", () => {
    const q = parseQuery(buildCcSwitchImportLink("/bin/x", ["claude", "opencode"]));
    expect(q.apps).toBe("claude,opencode");
  });

  // #1361: the two wire-format defects, one test each.

  it("Base64-encodes config — raw JSON makes CC-Switch fail at offset 0", () => {
    // `deeplink/mcp.rs` runs `decode_base64_param("config", …)` BEFORE parsing
    // JSON, so a URL-encoded JSON payload dies on its own first byte:
    // "Invalid symbol 123, offset 0" — 123 is `{`. That is the bug reported.
    const link = buildCcSwitchImportLink("/bin/x");
    const raw = parseQuery(link).config;
    expect(raw).not.toContain("{");
    expect(raw).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(() => decodeConfig(link)).not.toThrow();
  });

  it("wraps the entry in an mcpServers object keyed by the server id", () => {
    // `import_mcp_from_deeplink` requires `config.mcpServers` to be an object
    // and takes each KEY as the server id (`name` is ignored for resource=mcp),
    // so a bare `{command}` would import zero servers even once Base64 is fixed.
    const path = "/usr/local/bin/vmark-mcp-server";
    expect(decodeConfig(buildCcSwitchImportLink(path))).toEqual({
      mcpServers: { vmark: { command: path } },
    });
  });

  it("percent-escapes the Base64 payload so form-decoding cannot corrupt it", () => {
    // CC-Switch reads the query with `url::Url::query_pairs()`, which is
    // form-urlencoded: a bare `+` would arrive as a SPACE. Standard Base64
    // emits `+`, `/` and `=`, so every one of them must be escaped.
    const path = "/opt/vmark/_文5s中中LI"; // chosen so its Base64 holds + / and =
    const link = buildCcSwitchImportLink(path);
    const raw = link.slice(link.indexOf("&config=") + "&config=".length);
    expect(parseQuery(link).config).toMatch(/[+/=]/);
    expect(raw).toContain("%2B");
    expect(raw).toContain("%2F");
    expect(raw).toContain("%3D");
    expect(raw).toMatch(/^[A-Za-z0-9%]+$/);
  });

  it("round-trips a non-ASCII path (UTF-8 bytes, not Latin-1)", () => {
    // A bare btoa() throws on any codepoint above U+00FF, so a home directory
    // like /Users/张三 would break the button rather than the import.
    const path = "/Users/张三/Library/Application Support/vmark/vmark-mcp-server";
    expect(decodeConfig(buildCcSwitchImportLink(path))).toEqual({
      mcpServers: { vmark: { command: path } },
    });
  });

  it("encodes paths with spaces safely (no raw spaces in the link)", () => {
    const path = "/path/with spaces/bin";
    const link = buildCcSwitchImportLink(path);
    expect(link).not.toMatch(/ /);
    expect(decodeConfig(link)).toEqual({ mcpServers: { vmark: { command: path } } });
  });

  it("is a pure deterministic function", () => {
    const a = buildCcSwitchImportLink("/bin/x");
    const b = buildCcSwitchImportLink("/bin/x");
    expect(a).toBe(b);
  });
});
