// Two decisions the VMark MCP harness makes on every journey, both of which
// used to be unreachable from a test because they lived inside a function that
// spawns a process.

import { describe, it, expect } from "vitest";
import { parsePortFile, normalizeToolResult } from "./lib/vmarkMcp.mjs";

describe("parsePortFile", () => {
  it("reads the port from a well-formed file", () => {
    expect(parsePortFile("53421:9f2c1a\n")).toBe(53421);
  });

  it("accepts a bare port with no token", () => {
    expect(parsePortFile("53421")).toBe(53421);
  });

  it.each([
    ["a half-written file", "534"],   // valid, and that is the point: 534 is a port
  ])("accepts %s that still names a valid port", (_label, raw) => {
    expect(parsePortFile(raw)).toBeGreaterThan(0);
  });

  it.each([
    ["trailing garbage", "80x:token"],
    ["a leading token", "abc:80"],
    ["an empty file", ""],
    ["whitespace only", "   \n"],
    ["a port above the range", "70000:tok"],
    ["a zero port", "0:tok"],
    ["a negative port", "-1:tok"],
    ["a float", "80.5:tok"],
  ])("refuses %s", (_label, raw) => {
    // `parseInt("80x", 10)` is 80. A corrupted file therefore read as a good
    // port, and the run failed later against a port nothing was listening on —
    // a diagnosis pointing at the app rather than at the file.
    expect(parsePortFile(raw)).toBeNull();
  });
});

describe("normalizeToolResult", () => {
  it("prefers structuredContent over parsing the prose", () => {
    // `staleError.ts` attaches `current_revision` here precisely so a caller
    // can branch without parsing a sentence. Reading only `content` made the
    // one field the protocol guarantees unreachable from a journey.
    const result = normalizeToolResult({
      result: {
        isError: true,
        content: [{ type: "text", text: "STALE: document changed since revision 4" }],
        structuredContent: { code: "stale", current_revision: 7 },
      },
    });
    expect(result.json).toEqual({ code: "stale", current_revision: 7 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("STALE");
  });

  it("falls back to parsing the text when there is no structuredContent", () => {
    const result = normalizeToolResult({
      result: { content: [{ type: "text", text: '{"tabs":2}' }] },
    });
    expect(result.json).toEqual({ tabs: 2 });
  });

  it("leaves json undefined for prose", () => {
    const result = normalizeToolResult({
      result: { content: [{ type: "text", text: "Opened /tmp/a.md" }] },
    });
    expect(result.json).toBeUndefined();
    expect(result.text).toBe("Opened /tmp/a.md");
  });

  it("joins several text parts and ignores non-text ones", () => {
    const result = normalizeToolResult({
      result: {
        content: [
          { type: "text", text: "one" },
          { type: "image", data: "…" },
          { type: "text", text: "two" },
        ],
      },
    });
    expect(result.text).toBe("one\ntwo");
    expect(result.content).toHaveLength(3);
  });

  it("reports a protocol-level error as an error result", () => {
    const result = normalizeToolResult({ error: { code: -32601, message: "no such tool" } });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("no such tool");
    expect(result.json).toBeUndefined();
  });

  it("treats a missing isError as success", () => {
    expect(normalizeToolResult({ result: { content: [] } }).isError).toBe(false);
  });

  it("survives a reply with no result at all", () => {
    const result = normalizeToolResult({});
    expect(result).toEqual({ isError: false, text: "", json: undefined, content: [] });
  });

  it("keeps structuredContent even when it is falsy-looking", () => {
    // `{}` and `0` are legitimate structured payloads; only `undefined` means
    // "the sidecar sent none", so the fallback must key on exactly that.
    expect(normalizeToolResult({ result: { structuredContent: {} } }).json).toEqual({});
  });
});
