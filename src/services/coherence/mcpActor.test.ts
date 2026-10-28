// @vitest-environment node
// WI-AL1.5 — the coherence actor of an MCP write is the real connection, not
// a shared "mcp-client": each of the four principal states is recorded as
// itself, a second client (even of the same provider) is a different actor,
// and the untrusted session label can never forge a principal or connection.

import { describe, expect, it } from "vitest";
import { FIXTURE_ATTRIBUTIONS, onConnection } from "@/test/mcpAttributionFixture";
import type { McpAttribution } from "@/services/mcpBridge/types";
import { mcpCoherenceAgent } from "./mcpActor";

const OTHER_CONNECTION = "00000000-0000-4000-8000-0000000b0000";

function withLabel(attribution: McpAttribution, sessionLabel: string | null): McpAttribution {
  return { ...attribution, sessionLabel };
}

/** The `;`-separated segments of an actor id, as key → raw value. */
function segments(id: string): Array<[string, string]> {
  const [head, ...rest] = id.split(";");
  expect(head).toBe("mcp");
  return rest.map((s) => {
    const eq = s.indexOf("=");
    return [s.slice(0, eq), s.slice(eq + 1)];
  });
}

describe("mcpCoherenceAgent records the real actor", () => {
  it.each([
    ["anonymous", "mcp;principal=anonymous;connection=00000000-0000-4000-8000-000000a10000"],
    ["unrecognized", "mcp;principal=unrecognized;connection=00000000-0000-4000-8000-000000a10001"],
    [
      "ambiguous",
      "mcp;principal=ambiguous:claude,codex;connection=00000000-0000-4000-8000-000000a10002;session=nightly%20sweep",
    ],
  ] as const)("principal state %s", (state, id) => {
    expect(mcpCoherenceAgent(FIXTURE_ATTRIBUTIONS[state])).toEqual({ type: "model", id });
  });

  it("principal state provider, with a 128-byte CJK session label", () => {
    const attribution = FIXTURE_ATTRIBUTIONS.provider;
    expect(mcpCoherenceAgent(attribution)).toEqual({
      type: "model",
      id:
        "mcp;principal=provider:claude;connection=00000000-0000-4000-8000-000000a10003" +
        `;session=${encodeURIComponent(attribution.sessionLabel ?? "")}`,
    });
  });

  it("keeps the four principal states distinct and never shared", () => {
    const ids = Object.values(FIXTURE_ATTRIBUTIONS).map((a) => mcpCoherenceAgent(a).id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).not.toContain("mcp-client");
  });

  it("gives the same provider on a second connection (client B) a different actor", () => {
    const clientA = FIXTURE_ATTRIBUTIONS.provider;
    const clientB = onConnection(clientA, OTHER_CONNECTION);
    const a = mcpCoherenceAgent(clientA).id;
    const b = mcpCoherenceAgent(clientB).id;
    expect(a).not.toBe(b);
    expect(segments(b)).toContainEqual(["connection", OTHER_CONNECTION]);
    expect(segments(b)).toContainEqual(["principal", "provider:claude"]);
  });

  it("omits the session segment when there is no label, and keeps an empty one", () => {
    const anon = FIXTURE_ATTRIBUTIONS.anonymous;
    expect(mcpCoherenceAgent(anon).id).not.toContain(";session");
    expect(mcpCoherenceAgent(withLabel(anon, "")).id.endsWith(";session=")).toBe(true);
  });

  it("escapes a label that tries to forge a principal or connection segment", () => {
    const forged = ";principal=provider:evil;connection=" + OTHER_CONNECTION;
    const parsed = segments(mcpCoherenceAgent(withLabel(FIXTURE_ATTRIBUTIONS.anonymous, forged)).id);
    expect(parsed).toEqual([
      ["principal", "anonymous"],
      ["connection", "00000000-0000-4000-8000-000000a10000"],
      ["session", encodeURIComponent(forged)],
    ]);
    expect(decodeURIComponent(parsed[2][1])).toBe(forged);
  });

  it("escapes provider ids holding separators", () => {
    const tricky: McpAttribution = {
      ...FIXTURE_ATTRIBUTIONS.ambiguous,
      principal: { kind: "ambiguous", providers: ["a,b", "c;d=e:f"] },
    };
    const principal = segments(mcpCoherenceAgent(tricky).id)[0];
    expect(principal).toEqual(["principal", "ambiguous:a%2Cb,c%3Bd%3De%3Af"]);
  });
});
