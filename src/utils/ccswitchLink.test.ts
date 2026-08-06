// CC-Switch deep-link builder (issue #1008).

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

  it("URL-encodes the config JSON and round-trips to the MCP command", () => {
    const path = "/Users/me/Library/Application Support/vmark/vmark-mcp-server";
    const q = parseQuery(buildCcSwitchImportLink(path));
    expect(JSON.parse(q.config)).toEqual({ command: path });
  });

  it("encodes paths with spaces safely (no raw spaces in the link)", () => {
    const link = buildCcSwitchImportLink("/path/with spaces/bin");
    expect(link).not.toMatch(/ /);
    const q = parseQuery(link);
    expect(JSON.parse(q.config).command).toBe("/path/with spaces/bin");
  });

  it("is a pure deterministic function", () => {
    const a = buildCcSwitchImportLink("/bin/x");
    const b = buildCcSwitchImportLink("/bin/x");
    expect(a).toBe(b);
  });
});
