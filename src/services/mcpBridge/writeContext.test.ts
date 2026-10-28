// WI-AL1.1 — McpWriteContext: built once per request from the validated attribution, deep-frozen, never aliasing the event; the anonymous, unrecognized, ambiguous and provider principal states each round-trip from the Rust envelope into the context unchanged
// @vitest-environment node
import { describe, it, expect } from "vitest";
import fixture from "@/test/fixtures/mcpRequestEnvelope.json";
import { parseMcpAttribution } from "./attribution";
import { createMcpWriteContext } from "./writeContext";
import type { McpAttribution, McpRequestEvent } from "./types";

type EnvelopeName = keyof typeof fixture.envelopes;
const NAMES = Object.keys(fixture.envelopes) as EnvelopeName[];

/** The event `useMcpBridge` builds from one Rust-generated envelope. */
function eventFrom(name: EnvelopeName): McpRequestEvent {
  const envelope = fixture.envelopes[name];
  const attribution = parseMcpAttribution(envelope.attribution);
  if (attribution === null) throw new Error(`fixture ${name} does not parse`);
  return {
    id: envelope.id,
    type: envelope.type,
    args: JSON.parse(envelope.args_json) as Record<string, unknown>,
    attribution,
  };
}

describe("createMcpWriteContext — the four principal states", () => {
  it("covers anonymous, unrecognized, ambiguous and provider", () => {
    expect([...NAMES].sort()).toEqual(["ambiguous", "anonymous", "provider", "unrecognized"]);
  });

  it.each(NAMES)("carries the %s principal through unchanged", (name) => {
    const event = eventFrom(name);
    const context = createMcpWriteContext(event);
    // Only who is writing: the request id and operation have no consumer.
    expect(Object.keys(context)).toEqual(["attribution"]);
    expect(context.attribution).toEqual(fixture.envelopes[name].attribution);
    expect(context.attribution.principal.kind).toBe(name);
  });

  it("keeps an ambiguous principal's providers, in order", () => {
    const context = createMcpWriteContext(eventFrom("ambiguous"));
    expect(context.attribution.principal).toEqual({ kind: "ambiguous", providers: ["claude", "codex"] });
  });

  it("keeps a provider's id and its 128-byte CJK session label verbatim", () => {
    const context = createMcpWriteContext(eventFrom("provider"));
    expect(context.attribution.principal).toEqual({ kind: "provider", providerId: "claude" });
    const label = context.attribution.sessionLabel ?? "";
    expect(new TextEncoder().encode(label).length).toBe(128);
    expect(label).toBe(fixture.envelopes.provider.attribution.sessionLabel);
  });

  it("keeps an anonymous connection's absent label and name as null, not a default", () => {
    const context = createMcpWriteContext(eventFrom("anonymous"));
    expect(context.attribution.sessionLabel).toBeNull();
    expect(context.attribution.displayName).toBeNull();
  });

  it("keeps an unrecognized connection's untrusted name apart from its principal", () => {
    const context = createMcpWriteContext(eventFrom("unrecognized"));
    expect(context.attribution.principal).toEqual({ kind: "unrecognized" });
    expect(context.attribution.displayName).toBe("claude-code");
  });
});

describe("createMcpWriteContext — immutable", () => {
  it.each(NAMES)("the %s context is frozen all the way down", (name) => {
    const context = createMcpWriteContext(eventFrom(name));
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.attribution)).toBe(true);
    expect(Object.isFrozen(context.attribution.principal)).toBe(true);
  });

  it("refuses a handler's attempt to rewrite who is writing", () => {
    const context = createMcpWriteContext(eventFrom("ambiguous"));
    expect(Reflect.set(context, "attribution", null)).toBe(false);
    expect(Reflect.set(context.attribution, "connectionId", "forged")).toBe(false);
    expect(Reflect.set(context.attribution.principal, "kind", "provider")).toBe(false);
    const principal = context.attribution.principal;
    if (principal.kind !== "ambiguous") throw new Error("expected ambiguous");
    expect(Object.isFrozen(principal.providers)).toBe(true);
    expect(context.attribution.principal.kind).toBe("ambiguous");
  });

  it("does not alias an event whose attribution was built unfrozen", () => {
    const loose = structuredClone(eventFrom("ambiguous").attribution) as {
      -readonly [K in keyof McpAttribution]: McpAttribution[K];
    };
    const event: McpRequestEvent = { id: "r-1", type: "vmark.document.write", args: {}, attribution: loose };
    const context = createMcpWriteContext(event);
    loose.sessionLabel = "rewritten after the fact";
    loose.principal = { kind: "anonymous" };
    expect(context.attribution.sessionLabel).toBe("nightly sweep");
    expect(context.attribution.principal.kind).toBe("ambiguous");
    expect(Object.isFrozen(context.attribution)).toBe(true);
  });

  it("builds a distinct context per request, even on the same connection", () => {
    const a = createMcpWriteContext(eventFrom("provider"));
    const b = createMcpWriteContext({ ...eventFrom("provider"), id: "bridge-99" });
    expect(a).not.toBe(b);
    expect(a.attribution.connectionId).toBe(b.attribution.connectionId);
    expect(a.attribution).not.toBe(b.attribution);
  });
});

describe("createMcpWriteContext — fails loud, never defaults", () => {
  it.each([
    ["a collapsed 'unknown' principal", { principal: { kind: "unknown" } }],
    ["a missing connection id", { connectionId: undefined }],
    ["a counter instead of a UUID", { connectionId: "7" }],
    ["an over-limit session label", { sessionLabel: "审".repeat(43) }],
  ])("throws on %s", (_label, patch) => {
    const forged = { ...fixture.envelopes.provider.attribution, ...patch } as unknown as McpAttribution;
    const event: McpRequestEvent = { id: "r-forged", type: "vmark.document.write", args: {}, attribution: forged };
    expect(() => createMcpWriteContext(event)).toThrow(/r-forged/);
  });
});
