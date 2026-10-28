// WI-AL2.1d — the MCP trust boundary: no operation schema admits a provenance, certificate, capture, hunks or spans key at any depth, and the bridge refuses a request carrying one, naming the key
//
// Provenance, certificates, capture ids, hunks and spans are produced inside
// the webview by the collectors and the coordinator, from the transaction
// actually dispatched. An MCP agent is untrusted, so none of them may arrive
// as an MCP argument. Two halves pin that:
//   - the contract: the real zod schemas the sidecar validates against, and
//     the generated webview contract, declare none of those keys anywhere;
//   - the boundary: a request that carries one anyway is refused by the
//     webview router before any handler runs, whatever the operation's
//     unknown-field posture, and the refusal names the key.
// Only the Tauri boundary is replaced (`invoke`); the router, dispatcher,
// handlers and stores are real.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { BRIDGE_OPERATION_SCHEMAS } from "../../../../server/mcp/src/bridge/operationSchemas";
import { BRIDGE_OPERATION_FIELDS } from "@/services/mcpBridge/v2/generated/bridgeContracts";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { handleRequest } from "@/services/mcpBridge/handleRequest";
import type { McpResponse } from "@/services/mcpBridge/types";
import { withAttribution } from "@/test/mcpAttributionFixture";

const FORBIDDEN = ["provenance", "certificate", "capture", "hunks", "spans"] as const;

interface ZodNode {
  _zod: { def: Record<string, unknown> & { type: string } };
}

/** Wrappers whose admitted keys are their inner schema's. */
const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "readonly", "nonoptional", "catch"]);
/** Leaves: admit no key of their own. */
const LEAVES = new Set([
  "string", "number", "boolean", "bigint", "unknown", "any", "literal", "enum",
  "null", "undefined", "never", "date", "nan", "void", "symbol", "int",
]);

/**
 * Every object key `schema` admits, at any depth, as `path.key`. Fails loud on
 * a schema kind it does not know, so a new construct cannot hide a key.
 */
function admittedKeys(schema: unknown, path: string, out: string[]): string[] {
  const def = (schema as ZodNode)._zod.def;
  const kids = (...nodes: unknown[]) => nodes.forEach((n) => n && admittedKeys(n, path, out));
  if (def.type === "object") {
    for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
      out.push(`${path}.${key}`);
      admittedKeys(child, `${path}.${key}`, out);
    }
    kids(def.catchall);
  } else if (WRAPPERS.has(def.type)) kids(def.innerType);
  else if (def.type === "array") kids(def.element);
  else if (def.type === "record") kids(def.keyType, def.valueType);
  else if (def.type === "union") kids(...(def.options as unknown[]));
  else if (def.type === "intersection") kids(def.left, def.right);
  else if (def.type === "tuple") kids(...(def.items as unknown[]), def.rest);
  else if (def.type === "pipe") kids(def.in, def.out);
  else if (def.type === "lazy") kids((def.getter as () => unknown)());
  else if (!LEAVES.has(def.type)) throw new Error(`${path}: unhandled zod kind '${def.type}'`);
  return out;
}

/** The admitted keys whose own name is in `forbidden`. */
function offending(keys: string[], forbidden: readonly string[]): string[] {
  return keys.filter((k) => forbidden.includes(k.split(".").pop() ?? ""));
}

describe("MCP operation contract", () => {
  it("no MCP operation schema admits provenance, certificate, capture, hunks or spans", () => {
    const keys: string[] = [];
    for (const [operation, schema] of Object.entries(BRIDGE_OPERATION_SCHEMAS)) {
      admittedKeys(schema, operation, keys);
    }
    for (const [operation, fields] of Object.entries(BRIDGE_OPERATION_FIELDS)) {
      for (const field of fields) keys.push(`generated:${operation}.${field.name}`);
    }
    // The walk must have reached the real surface, not an empty map.
    expect(keys).toContain("vmark.document.write.content");
    expect(keys).toContain("generated:vmark.selection.set.content");
    const forbidden = ["provenance", "certificate", "capture", "hunks", "spans"];
    expect(forbidden).toEqual([...FORBIDDEN]);
    expect(offending(keys, forbidden)).toEqual([]);
  });

  it("the walk finds a forbidden key however deeply a schema nests it", () => {
    const nested = z.object({
      tabId: z.string().optional(),
      edits: z.array(z.object({ meta: z.record(z.string(), z.object({ spans: z.unknown() })) })).optional(),
      target: z.union([z.object({ capture: z.string() }), z.object({ certificate: z.string().nullable() })]),
    });
    expect(offending(admittedKeys(nested, "probe", []), FORBIDDEN)).toEqual([
      "probe.edits.meta.spans",
      "probe.target.capture",
      "probe.target.certificate",
    ]);
  });
});

/** The single reply the bridge sent to `id`. */
function replyTo(id: string): McpResponse {
  const found = vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: McpResponse }).payload)
    .filter((r) => r.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

function openTab(id: string, content: string): void {
  useTabStore.setState({
    tabs: {
      main: [{ kind: "document" as const, id, filePath: null, title: id, isPinned: false, formatId: "markdown" }],
    },
    activeTabId: { main: id },
  });
  useDocumentStore.getState().initDocument(id, content, null);
}

const content = (id: string) => useDocumentStore.getState().documents[id].content;

describe("the bridge refuses trust-reserved keys", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    useTabStore.setState({ tabs: {}, activeTabId: {} });
    useDocumentStore.setState({ documents: {} });
    useRevisionStore.setState({ revisions: {} });
  });

  it("the bridge refuses a request that carries a provenance key, naming the key", async () => {
    openTab("t1", "测试 before");
    const revision = useRevisionStore.getState().getRevision("t1");

    await handleRequest(withAttribution({
      id: "req-prov",
      type: "vmark.document.write",
      args: { tabId: "t1", content: "after", save: false, provenance: { spans: [], certified: true } },
    }));

    const reply = replyTo("req-prov");
    const isError = reply.success === false;
    expect(isError).toBe(true);
    expect(reply.error).toContain("'provenance'");
    expect(content("t1")).toBe("测试 before");
    expect(useRevisionStore.getState().getRevision("t1")).toBe(revision);
  });

  it.each(FORBIDDEN.map((key) => ({ key })))("refuses '$key' on a write, naming it", async ({ key }) => {
    openTab("t1", "before");
    await handleRequest(withAttribution({
      id: `req-${key}`,
      type: "vmark.selection.set",
      args: { content: "after", [key]: "x" },
    }));
    const reply = replyTo(`req-${key}`);
    expect(reply.success).toBe(false);
    expect(reply.error).toContain(`'${key}'`);
    expect(content("t1")).toBe("before");
  });

  it("refuses it on a strip-and-log operation too, where unknown fields are otherwise tolerated", async () => {
    await handleRequest(withAttribution({
      id: "req-session",
      type: "vmark.session.get_state",
      args: { clientProtocol: "2", certificate: {} },
    }));
    const reply = replyTo("req-session");
    expect(reply.success).toBe(false);
    expect(reply.error).toContain("'certificate'");
  });

  it("names every reserved key a request carries, and still answers an ordinary one", async () => {
    await handleRequest(withAttribution({
      id: "req-many",
      type: "vmark.document.read",
      args: { hunks: [], capture: {} },
    }));
    expect(replyTo("req-many").error).toMatch(/'capture'.*'hunks'/);

    openTab("t1", "# fine\n");
    await handleRequest(withAttribution({ id: "req-ok", type: "vmark.document.read", args: {} }));
    expect(replyTo("req-ok").success).toBe(true);
  });
});
