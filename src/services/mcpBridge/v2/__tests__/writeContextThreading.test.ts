// WI-AL1.1 — the immutable McpWriteContext is built by the bridge request handler and threaded through dispatchV2 to every document-mutating handler, for the anonymous, unrecognized, ambiguous and provider principal states alike
//
// Everything from the router to the journal runs for real — handleRequest,
// the read-only guard, dispatchV2 and the four mutating handlers. The hand-off
// is observed where the context is spent: the actor each handler sends to the
// journal's prepare (the in-memory journal fake, `src/test/globalTestHooks.ts`).
// The context's own guarantees (frozen, never aliasing the event's
// attribution, one per request) are `writeContext.test.ts`'s subject.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { invoke } from "@tauri-apps/api/core";
import fixture from "@/test/fixtures/mcpRequestEnvelope.json";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { parseMcpAttribution } from "@/services/mcpBridge/attribution";
import { handleRequest } from "@/services/mcpBridge/handleRequest";
import { createMcpWriteContext } from "@/services/mcpBridge/writeContext";
import { dispatchV2 } from "@/services/mcpBridge/v2/dispatch";
import { journalActorFor } from "@/services/agentJournal/journalActor";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import type { McpAttribution, McpRequestEvent, McpResponse } from "@/services/mcpBridge/types";

const WORKFLOW = "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
const TAB = "t1";

let views: CMView[] = [];

/** One open tab holding `text`, active in the main window. */
function seed(text: string, filePath: string | null = null): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath, title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, text, filePath);
}

/** A Source-mode view over the tab with "world" selected, for selection.set. */
function mountSource(text: string): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new CMView({ state: CMState.create({ doc: text, selection: { anchor: 6, head: 11 } }), parent });
  views.push(view);
  useUIStore.setState({ sourceMode: true });
  useEditorStore.getState().setActiveSourceView(view, TAB);
}

/** Each mutating tool, with a document it changes and arguments that change it. */
const MUTATORS = [
  { type: "vmark.document.write", tool: "document.write", args: { content: "AI text\n", save: false }, setup: () => seed("old\n") },
  { type: "vmark.document.transform", tool: "document.transform", args: { tabId: TAB, kind: "cjk-spacing" }, setup: () => seed("测试ABC混合") },
  {
    type: "vmark.workflow.apply_patch",
    tool: "workflow.apply_patch",
    args: { patches: [{ kind: "workflow.set", path: "name", value: "renamed" }] },
    setup: () => seed(WORKFLOW, "/repo/.github/workflows/ci.yml"),
  },
  {
    type: "vmark.selection.set",
    tool: "selection.set",
    args: { content: "世界" },
    setup: () => {
      seed("hello world");
      mountSource("hello world");
    },
  },
] as const;

type EnvelopeName = keyof typeof fixture.envelopes;
const PRINCIPALS = Object.keys(fixture.envelopes) as EnvelopeName[];

const CASES = PRINCIPALS.flatMap((principal) => MUTATORS.map((m) => ({ principal, ...m })));

function attributionOf(name: EnvelopeName): McpAttribution {
  const parsed = parseMcpAttribution(fixture.envelopes[name].attribution);
  if (parsed === null) throw new Error(`fixture ${name} does not parse`);
  return parsed;
}

/** The (tool, actor) of every prepare the journal received. */
const prepares = () =>
  fake.prepareControlledWrite.mock.calls.map(([input]) => ({ tool: input.tool, actor: input.actor }));

function replies(): McpResponse[] {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "mcp_bridge_respond")
    .map(([, args]) => (args as { payload: McpResponse }).payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUIStore.setState({ sourceMode: false });
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  for (const v of views) {
    v.dom.parentElement?.remove();
    v.destroy();
  }
  views = [];
});

describe("handleRequest → dispatchV2 → mutating handler", () => {
  it("names all four principal states and all four document mutators", () => {
    expect([...PRINCIPALS].sort()).toEqual(["ambiguous", "anonymous", "provider", "unrecognized"]);
    expect(CASES).toHaveLength(16);
  });

  it.each(CASES)("$type journals the $principal principal's actor", async ({ principal, type, tool, args, setup }) => {
    setup();
    const event: McpRequestEvent = { id: `req-${principal}-${type}`, type, args, attribution: attributionOf(principal) };

    await handleRequest(event);

    expect(prepares()).toEqual([{ tool, actor: journalActorFor(attributionOf(principal)) }]);
    expect(replies()).toEqual([expect.objectContaining({ id: event.id, success: true })]);
  });

  it("refuses a request whose attribution does not validate, and nothing reaches the journal", async () => {
    seed("old\n");
    const malformed = { ...fixture.envelopes.anonymous.attribution, principal: { kind: "unknown" } };
    await handleRequest({
      id: "req-malformed",
      type: "vmark.document.write",
      args: { content: "x", save: false },
      attribution: malformed as unknown as McpAttribution,
    });
    expect(prepares()).toEqual([]);
    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("old\n");
    expect(replies()).toEqual([expect.objectContaining({ id: "req-malformed", success: false })]);
  });

  it("a read reaches no mutator", async () => {
    seed("old\n");
    await handleRequest({ id: "req-read", type: "vmark.document.read", args: {}, attribution: attributionOf("anonymous") });
    expect(prepares()).toEqual([]);
  });

  it("two requests on one connection are each journaled under that connection", async () => {
    const attribution = attributionOf("unrecognized");
    for (const [id, content] of [["req-a", "first\n"], ["req-b", "second\n"]] as const) {
      seed(`before ${id}\n`);
      await handleRequest({ id, type: "vmark.document.write", args: { content, save: false }, attribution });
    }
    const actors = prepares().map((p) => p.actor);
    expect(actors).toEqual([journalActorFor(attribution), journalActorFor(attribution)]);
  });
});

describe("dispatchV2 — threads the context it is given", () => {
  it.each(MUTATORS)("$type journals the given context's actor, not one rebuilt from the event", async ({ type, tool, args, setup }) => {
    setup();
    const event: McpRequestEvent = { id: `req-same-${type}`, type, args, attribution: attributionOf("anonymous") };
    const context = createMcpWriteContext({ ...event, attribution: attributionOf("ambiguous") });
    expect(await dispatchV2(event, context)).toBe(true);
    expect(prepares()).toEqual([{ tool, actor: journalActorFor(context.attribution) }]);
    expect(journalActorFor(context.attribution)).not.toEqual(journalActorFor(event.attribution));
  });
});
