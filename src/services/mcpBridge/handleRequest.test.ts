// WI-RA1A.8 — the top-level MCP request router, tested by what it REPLIES.
//
// The router's own collaborators are real here: the dispatcher, the handlers
// behind it, the read-only guard and the stores. This suite used to mock
// `./utils` and `v2/dispatch` — both direct imports of the subject — and then
// assert that the mocks had been called, which would have stayed green with
// the router wired to nothing. The only thing replaced is the Tauri boundary:
// every reply is read from the `mcp_bridge_respond` invoke the bridge receives.
//
// What it pins:
//   - a mutation aimed at a read-only document is refused with the structured
//     READ_ONLY envelope and changes nothing, judged by the tab the request
//     TARGETS, not the focused one;
//   - reads are never blocked by read-only;
//   - an unknown request type gets a diagnostic naming what this build routes;
//   - a failure outside any handler still produces a reply.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { SUPPORTED_TOOL_PREFIXES } from "@/services/mcpBridge/v2/dispatch";
import type { McpResponse } from "./types";
import { handleRequest } from "./handleRequest";
import { withAttribution } from "@/test/mcpAttributionFixture";

// A lazily loaded handler chunk that fails to load: the one failure that
// reaches the router from OUTSIDE a handler's own error wrapper.
const browserChunk = vi.hoisted(() => ({ failure: null as Error | null }));
vi.mock("@/services/mcpBridge/v2/browser", async (importOriginal) => {
  if (browserChunk.failure) throw browserChunk.failure;
  return importOriginal();
});

/** Every reply the bridge received through `boundary`, in order. */
function replies(boundary: typeof invoke = invoke): McpResponse[] {
  return vi
    .mocked(boundary)
    .mock.calls.filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: McpResponse }).payload);
}

/** The single reply to `id`; zero or several replies is a failure. */
function replyTo(id: string, boundary: typeof invoke = invoke): McpResponse {
  const found = replies(boundary).filter((r) => r.id === id);
  expect(found).toHaveLength(1);
  return found[0];
}

function structuredError(reply: McpResponse): { error: string; message: string } | null {
  try {
    return JSON.parse(reply.error ?? "");
  } catch {
    return null;
  }
}

const content = (tabId: string) => useDocumentStore.getState().documents[tabId].content;

/** Open `tabs` in the focused window; the first is the active tab. */
function openTabs(tabs: Array<{ id: string; content: string; readOnly?: boolean }>): void {
  useTabStore.setState({
    tabs: {
      main: tabs.map((t) => ({
        kind: "document" as const,
        id: t.id,
        filePath: null,
        title: t.id,
        isPinned: false,
        formatId: "markdown",
      })),
    },
    activeTabId: { main: tabs[0].id },
  });
  for (const t of tabs) {
    useDocumentStore.getState().initDocument(t.id, t.content, null);
    if (t.readOnly) useDocumentStore.getState().setReadOnly(t.id, true);
  }
}

beforeEach(() => {
  vi.mocked(invoke).mockClear();
  browserChunk.failure = null;
  useTabStore.setState({ tabs: {}, activeTabId: {} });
  useDocumentStore.setState({ documents: {} });
  useRevisionStore.setState({ revisions: {} });
  useUIStore.setState({ sourceMode: false });
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setActiveSourceView(null);
});

describe("handleRequest — mutations of a read-only document", () => {
  it.each([
    { type: "vmark.document.write", args: { content: "overwritten" } },
    { type: "vmark.document.transform", args: { kind: "cjk-spacing" } },
    { type: "vmark.workflow.apply_patch", args: { patches: [] } },
    { type: "vmark.selection.set", args: { content: "overwritten" } },
  ])("refuses $type with the structured READ_ONLY envelope and changes nothing", async ({ type, args }) => {
    openTabs([{ id: "t-locked", content: "测试ABC", readOnly: true }]);
    const revision = useRevisionStore.getState().getRevision("t-locked");

    await handleRequest(withAttribution({ id: "req-ro", type, args }));

    const reply = replyTo("req-ro");
    expect(reply.success).toBe(false);
    expect(structuredError(reply)).toEqual({ error: "READ_ONLY", message: "Document is read-only" });
    expect(content("t-locked")).toBe("测试ABC");
    expect(useRevisionStore.getState().getRevision("t-locked")).toBe(revision);
  });

  it("refuses a request with no valid attribution before judging read-only", async () => {
    openTabs([{ id: "t-locked", content: "locked", readOnly: true }]);

    await handleRequest({ id: "req-anon", type: "vmark.document.write", args: { content: "x" } } as never);

    const reply = replyTo("req-anon");
    expect(reply.success).toBe(false);
    expect(reply.error).toMatch(/no valid attribution/);
    expect(content("t-locked")).toBe("locked");
  });

  it("refuses a write that TARGETS a read-only background tab, though the focused tab is writable", async () => {
    openTabs([
      { id: "t-focused", content: "focused" },
      { id: "t-locked", content: "locked", readOnly: true },
    ]);

    await handleRequest(withAttribution({
      id: "req-bg",
      type: "vmark.document.write",
      args: { tabId: "t-locked", content: "overwritten", save: false },
    }));

    expect(structuredError(replyTo("req-bg"))?.error).toBe("READ_ONLY");
    expect(content("t-locked")).toBe("locked");
  });

  it("allows a write that TARGETS a writable background tab, though the focused tab is read-only", async () => {
    openTabs([
      { id: "t-locked", content: "locked", readOnly: true },
      { id: "t-writable", content: "before" },
    ]);

    await handleRequest(withAttribution({
      id: "req-ok",
      type: "vmark.document.write",
      args: { tabId: "t-writable", content: "after", save: false },
    }));

    const reply = replyTo("req-ok");
    expect(reply.success).toBe(true);
    expect(reply.data).toMatchObject({ saved: false, save_skipped: "opt_out" });
    expect(content("t-writable")).toBe("after");
    expect(content("t-locked")).toBe("locked");
  });

  it("judges a request that names no tab by the focused tab", async () => {
    openTabs([
      { id: "t-writable", content: "before" },
      { id: "t-locked", content: "locked", readOnly: true },
    ]);

    await handleRequest(withAttribution({
      id: "req-focused",
      type: "vmark.document.write",
      args: { content: "after", save: false },
    }));

    expect(replyTo("req-focused").success).toBe(true);
    expect(content("t-writable")).toBe("after");
  });

  it("treats a non-string tabId as naming no tab, not as a writable one", async () => {
    openTabs([{ id: "t-locked", content: "locked", readOnly: true }]);

    await handleRequest(withAttribution({
      id: "req-bad-tab",
      type: "vmark.document.write",
      args: { tabId: 42, content: "overwritten", save: false },
    }));

    expect(structuredError(replyTo("req-bad-tab"))?.error).toBe("READ_ONLY");
    expect(content("t-locked")).toBe("locked");
  });
});

describe("handleRequest — reads of a read-only document", () => {
  it("document.read is answered with the content", async () => {
    openTabs([{ id: "t-locked", content: "# locked\n", readOnly: true }]);

    await handleRequest(withAttribution({ id: "req-read", type: "vmark.document.read", args: {} }));

    const reply = replyTo("req-read");
    expect(reply.success).toBe(true);
    expect(reply.data).toMatchObject({ content: "# locked\n", kind: "markdown", dirty: false });
  });

  it("selection.get reaches its handler instead of being refused as READ_ONLY", async () => {
    openTabs([{ id: "t-locked", content: "# locked\n", readOnly: true }]);

    await handleRequest(withAttribution({ id: "req-sel", type: "vmark.selection.get", args: {} }));

    // No editor is mounted in this suite, so the handler's own answer is
    // NO_EDITOR — which only the handler can give.
    expect(structuredError(replyTo("req-sel"))?.error).toBe("NO_EDITOR");
  });
});

describe("handleRequest — unknown request types", () => {
  it("names the type, every tool prefix this build routes, and the version-skew cause", async () => {
    // Issue #900: a sidecar/app version mismatch sends a type the dispatcher
    // does not know; the error must let the user diagnose it without logs.
    await handleRequest(withAttribution({ id: "req-unknown", type: "vmark.bogus", args: {} }));

    const reply = replyTo("req-unknown");
    expect(reply.success).toBe(false);
    expect(reply.error).toContain("Unknown request type: vmark.bogus");
    for (const prefix of SUPPORTED_TOOL_PREFIXES) expect(reply.error).toContain(prefix);
    expect(reply.error).toContain("sidecar");
  });

  it.each(["constructor", "toString", "__proto__", ""])(
    "treats %j as unknown rather than resolving it on the route table",
    async (type) => {
      await handleRequest(withAttribution({ id: "req-proto", type, args: {} }));

      const reply = replyTo("req-proto");
      expect(reply.success).toBe(false);
      expect(reply.error).toContain("Unknown request type");
    },
  );
});

describe("handleRequest — failures outside a handler", () => {
  it("still answers the request when a handler chunk fails to load", async () => {
    // A fresh module graph, so the chunk has not been loaded by an earlier test.
    vi.resetModules();
    browserChunk.failure = new Error("Failed to fetch dynamically imported module");
    const router = await import("./handleRequest");
    const boundary = (await import("@tauri-apps/api/core")).invoke;
    vi.mocked(boundary).mockClear();
    // What loading the chunk rejects with, as this runtime reports it.
    const loadFailure: unknown = await import("@/services/mcpBridge/v2/browser").then(
      () => null,
      (error: unknown) => error,
    );
    expect(loadFailure).toBeInstanceOf(Error);

    await router.handleRequest(withAttribution({ id: "req-chunk", type: "vmark.browser.read", args: {} }));

    // A client left without a reply waits for its own timeout; it gets the
    // failure's own message instead.
    const reply = replyTo("req-chunk", boundary);
    expect(reply.success).toBe(false);
    expect(reply.error).toBe((loadFailure as Error).message);
  });
});
