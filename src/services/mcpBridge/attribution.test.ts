// WI-AL0.3 — Rust↔TS request-envelope parity: every Rust-generated envelope (one per principal state) parses with the TypeScript validator, and malformed attributions are refused, never defaulted
// @vitest-environment node
import { describe, it, expect } from "vitest";
import fixture from "@/test/fixtures/mcpRequestEnvelope.json";
import { parseMcpAttribution, MAX_SESSION_LABEL_BYTES } from "./attribution";
import type { McpPrincipal } from "./types";
import { isValidMcpRequestRaw } from "@/hooks/useMcpBridge";

const envelopes = Object.entries(fixture.envelopes);
const validBase = fixture.envelopes.provider.attribution;

describe("request envelope — Rust fixture parity", () => {
  it("the byte limit matches the Rust constant", () => {
    expect(MAX_SESSION_LABEL_BYTES).toBe(fixture.sessionLabelMaxBytes);
  });

  it("covers exactly the four principal states, each under its own tag", () => {
    const kinds = envelopes.map(([, e]) => e.attribution.principal.kind).sort();
    expect(kinds).toEqual(["ambiguous", "anonymous", "provider", "unrecognized"]);
  });

  it.each(envelopes)("parses the %s envelope losslessly", (name, envelope) => {
    expect(isValidMcpRequestRaw(envelope)).toBe(true);
    const parsed = parseMcpAttribution(envelope.attribution);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(envelope.attribution);
    expect(parsed?.principal.kind).toBe(name);
  });

  it("counts the 128-byte CJK label in bytes, as Rust does", () => {
    const label = fixture.envelopes.provider.attribution.sessionLabel;
    expect(new TextEncoder().encode(label).length).toBe(MAX_SESSION_LABEL_BYTES);
    expect(parseMcpAttribution(validBase)?.sessionLabel).toBe(label);
  });

  it("returns a frozen value a write context can carry unchanged", () => {
    const parsed = parseMcpAttribution(fixture.envelopes.ambiguous.attribution);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.principal)).toBe(true);
    const principal = parsed?.principal as Extract<McpPrincipal, { kind: "ambiguous" }>;
    expect(Object.isFrozen(principal.providers)).toBe(true);
  });

  it("does not alias the raw payload", () => {
    const raw = structuredClone(fixture.envelopes.ambiguous.attribution);
    const parsed = parseMcpAttribution(raw);
    raw.principal.providers.push("intruder");
    expect(parsed?.principal).toEqual({ kind: "ambiguous", providers: ["claude", "codex"] });
  });
});

describe("parseMcpAttribution — refuses rather than defaults", () => {
  const withPrincipal = (principal: unknown) => ({ ...validBase, principal });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "anonymous"],
    ["an array", []],
  ])("refuses an attribution that is %s", (_label, raw) => {
    expect(parseMcpAttribution(raw)).toBeNull();
  });

  it.each([
    ["no principal", { ...validBase, principal: undefined }],
    ["a collapsed 'unknown' principal", withPrincipal({ kind: "unknown" })],
    ["an untagged principal", withPrincipal({ providerId: "claude" })],
    ["a provider with no id", withPrincipal({ kind: "provider" })],
    ["a provider with an empty id", withPrincipal({ kind: "provider", providerId: "" })],
    ["an ambiguous principal naming one provider", withPrincipal({ kind: "ambiguous", providers: ["a"] })],
    ["an ambiguous principal with a non-string", withPrincipal({ kind: "ambiguous", providers: ["a", 1] })],
    ["an inherited kind", withPrincipal(Object.create({ kind: "anonymous" }))],
  ])("refuses %s", (_label, raw) => {
    expect(parseMcpAttribution(raw)).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["the client counter", "7"],
    ["not hyphenated", "00000000000000000000000000a10003"],
    ["upper-case", "00000000-0000-4000-8000-000000A10003"],
    ["the nil UUID", "00000000-0000-0000-0000-000000000000"],
    ["a version-1 UUID", "00000000-0000-1000-8000-000000a10003"],
    ["a version-7 UUID", "00000000-0000-7000-8000-000000a10003"],
    ["v4 with the NCS variant", "00000000-0000-4000-0000-000000a10003"],
    ["v4 with the Microsoft variant", "00000000-0000-4000-c000-000000a10003"],
  ])("refuses a connectionId that is %s (Rust mints only Uuid::new_v4)", (_label, connectionId) => {
    expect(parseMcpAttribution({ ...validBase, connectionId })).toBeNull();
  });

  it("refuses a session label one byte over the limit (43 CJK characters)", () => {
    expect(parseMcpAttribution({ ...validBase, sessionLabel: "审".repeat(43) })).toBeNull();
  });

  it.each([
    ["sessionLabel", 42],
    ["displayName", { name: "x" }],
  ])("refuses a non-string, non-null %s", (field, value) => {
    expect(parseMcpAttribution({ ...validBase, [field]: value })).toBeNull();
  });

  it.each(["sessionLabel", "displayName"])("refuses an absent %s (Rust always sends null)", (field) => {
    const raw: Record<string, unknown> = { ...validBase };
    delete raw[field];
    expect(parseMcpAttribution(raw)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["spaces only", "   "],
    ["Unicode spaces only", "\u3000\u00a0"],
    ["a newline", "line\nbreak"],
    ["a NUL", "a\u0000b"],
    ["a DEL", "a\u007fb"],
    ["a C1 control", "a\u0085b"],
  ])("refuses a session label that is %s (Rust sends null for blank, refuses control characters)", (_label, sessionLabel) => {
    expect(parseMcpAttribution({ ...validBase, sessionLabel })).toBeNull();
  });

  const bidi = fixture.bidiFormattingCodePoints.map((cp) => [`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`, String.fromCodePoint(cp)]);

  it("the Rust bidi formatting set is the one generated into the fixture", () => {
    expect(bidi.map(([name]) => name)).toEqual([
      "U+061C", "U+200E", "U+200F", "U+202A", "U+202B", "U+202C", "U+202D", "U+202E", "U+2066", "U+2067", "U+2068", "U+2069",
    ]);
  });

  it.each(bidi)("refuses a session label carrying the bidi formatting character %s, as Rust does", (_name, c) => {
    expect(parseMcpAttribution({ ...validBase, sessionLabel: `review${c}gpj.md` })).toBeNull();
  });

  it.each(bidi)("refuses a displayName carrying %s: Rust's peer_label strips it, so it cannot arrive", (_name, c) => {
    expect(parseMcpAttribution({ ...validBase, displayName: `claude${c}edoc` })).toBeNull();
  });

  it("refuses no other character as bidi formatting: the sets agree exactly", () => {
    const set = new Set(fixture.bidiFormattingCodePoints);
    for (let cp = 0x20; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (/\p{Cc}/u.test(String.fromCodePoint(cp))) continue;
      const label = `a${String.fromCodePoint(cp)}b`;
      const parsed = parseMcpAttribution({ ...validBase, sessionLabel: label });
      if ((parsed === null) !== set.has(cp)) throw new Error(`U+${cp.toString(16)}: refused ${parsed === null}`);
    }
  });

  it.each([
    ["a byte-order mark", "\ufeff"],
    ["CJK and emoji", "重构 😀"],
    ["a right-to-left label", "مراجعة"],
  ])("accepts a session label with %s, as Rust does", (_label, sessionLabel) => {
    expect(parseMcpAttribution({ ...validBase, sessionLabel })?.sessionLabel).toBe(sessionLabel);
  });

  it.each([
    ["sessionLabel", { sessionLabel: "a\ud800b" }],
    ["displayName", { displayName: "\udc00" }],
    ["providerId", { principal: { kind: "provider", providerId: "claude\ud83d" } }],
    ["an ambiguous provider", { principal: { kind: "ambiguous", providers: ["a", "\ud800"] } }],
  ])("refuses a lone surrogate in %s (no Rust string can hold one)", (_label, over) => {
    expect(parseMcpAttribution({ ...validBase, ...over })).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["spaces only", "  "],
    ["a newline", "claude\nv1"],
    ["a NUL", "a\u0000b"],
    ["a DEL", "a\u007fb"],
    ["a C1 control", "a\u0085b"],
    ["one character over the longest name-and-version Rust composes", "名".repeat(245)],
  ])("refuses a displayName that is %s (Rust strips controls from and bounds name and version)", (_label, displayName) => {
    expect(parseMcpAttribution({ ...validBase, displayName })).toBeNull();
  });

  it("accepts the longest displayName Rust can compose: two bounded parts joined by \" v\"", () => {
    const part = `${"名".repeat(120)}…`; // peer_label: 120 characters and the cut marker
    const displayName = `${part} v${part}`;
    expect([...displayName]).toHaveLength(244);
    expect(parseMcpAttribution({ ...validBase, displayName })?.displayName).toBe(displayName);
  });

  it("accepts null labels", () => {
    const parsed = parseMcpAttribution({ ...validBase, sessionLabel: null, displayName: null });
    expect(parsed?.sessionLabel).toBeNull();
    expect(parsed?.displayName).toBeNull();
  });
});
