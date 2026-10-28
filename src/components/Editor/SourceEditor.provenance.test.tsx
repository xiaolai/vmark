// WI-AL1.4 — the production SourceEditor mounts the Source provenance collector: typed edits reach the tab's session ahead of the store write (certified, no whole-document break), a hidden (kept-alive) editor reports nothing, and the collector stops before the view is destroyed.
// REAL: SourceEditor and its CodeMirror view, the collector, the provenance
// sessions, the tab/document stores behind the real open flow. FAKED:
// `@tauri-apps/*` (the stateful in-memory disk) and the journal's epoch client
// (the global fake). The collector is wrapped only to observe its lifecycle.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";

vi.mock("@tauri-apps/plugin-fs", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.fsModule();
});
vi.mock("@tauri-apps/api/core", async () => {
  const { statefulFs } = await import("@/test/statefulFsFake");
  return statefulFs.coreModule();
});
const seen = vi.hoisted(() => ({ isLive: null as null | (() => boolean), calls: [] as string[] }));
vi.mock("@/services/agentJournal/collectors/sourceCollector", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/agentJournal/collectors/sourceCollector")>();
  return {
    ...real,
    createSourceProvenance: (tabId: string | undefined, isLive: () => boolean) => {
      seen.isLive = isLive;
      const p = real.createSourceProvenance(tabId, isLive);
      return {
        extension: p.extension,
        start: (v: EditorView) => (seen.calls.push("start"), p.start(v)),
        stop: () => (seen.calls.push("stop"), p.stop()),
      };
    },
  };
});

import { WindowContext } from "@/contexts/WindowContext";
import { SourceEditor } from "@/components/Editor/SourceEditor";
import { useDocumentStore } from "@/stores/documentStore";
import { bootstrapFormats } from "@/lib/formats/registryBootstrap";
import { bindPluginHostSettings } from "@/services/assembly/bindHostSettings";
import { freezeUnsavedProvenance } from "@/services/agentJournal/unsavedProvenance";
import { provenanceSessionFor, startProvenanceSessions } from "@/services/agentJournal/provenanceSessions";
import { ROOT, WINDOW, openDocInTab, resetTier0 } from "@/test/tier0/harness";

const TEXT = "# Notes\n\nfirst line\n";
const settle = (ms = 400): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const LAYOUT_STUBS: Array<[object, string, () => unknown]> = [
  [Range.prototype, "getClientRects", () => []],
  [Range.prototype, "getBoundingClientRect", () => new DOMRect()],
];

let stopSessions: (() => void) | null = null;

const ui = (hidden: boolean) => (
  <WindowContext.Provider value={{ windowLabel: WINDOW, isDocumentWindow: true }}>
    <div className="editor-content">
      <SourceEditor hidden={hidden} />
    </div>
  </WindowContext.Provider>
);

/** Open TEXT in a tab whose session has a recorded basis, then mount the real editor on it. */
async function mount() {
  const tabId = await openDocInTab(`${ROOT}/notes.md`, TEXT);
  provenanceSessionFor(tabId)!.fork(TEXT).recorded("r0");
  const r = render(ui(false));
  await settle();
  const dom = document.querySelector<HTMLElement>(".cm-editor");
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) throw new Error("SourceEditor mounted no CodeMirror view");
  return { tabId, view, ...r };
}

async function wholeBreak(tabId: string) {
  const content = useDocumentStore.getState().documents[tabId].content;
  const f = freezeUnsavedProvenance(tabId, content)!;
  const named = await f.payload(null);
  expect(named).not.toBeNull();
  return (named!.payload as unknown as { body: { breaks: { whole: unknown } } }).body.breaks.whole;
}

beforeAll(() => {
  bootstrapFormats();
  bindPluginHostSettings();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
  resetTier0();
  seen.isLive = null;
  seen.calls = [];
  for (const [target, name, value] of LAYOUT_STUBS) Object.defineProperty(target, name, { configurable: true, value });
  stopSessions = startProvenanceSessions();
});

afterEach(() => {
  cleanup();
  stopSessions?.();
  stopSessions = null;
  for (const [target, name] of LAYOUT_STUBS) Reflect.deleteProperty(target, name);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("SourceEditor provenance", () => {
  it("certifies typed edits (CJK included): the session already holds each store write", async () => {
    const { tabId, view } = await mount();
    act(() => view.dispatch({ changes: { from: TEXT.length, insert: "寿司 and more\n" }, userEvent: "input.type" }));
    await settle();
    expect(useDocumentStore.getState().documents[tabId].content).toBe(`${TEXT}寿司 and more\n`);
    expect(provenanceSessionFor(tabId)!.text).toBe(`${TEXT}寿司 and more\n`);
    expect(await wholeBreak(tabId)).toBeNull();
  });

  it("a hidden (kept-alive) editor reports nothing: its liveness follows the hidden prop", async () => {
    const { rerender } = await mount();
    expect(seen.isLive?.()).toBe(true);
    rerender(ui(true));
    expect(seen.isLive?.()).toBe(false);
    rerender(ui(false));
    expect(seen.isLive?.()).toBe(true);
  });

  it("starts once with the view and stops before the view is destroyed", async () => {
    const realDestroy = EditorView.prototype.destroy;
    const destroy = vi.spyOn(EditorView.prototype, "destroy").mockImplementation(function (this: EditorView) {
      seen.calls.push("destroy");
      realDestroy.call(this);
    });
    const { unmount } = await mount();
    expect(seen.calls).toEqual(["start"]);
    unmount();
    expect(seen.calls).toEqual(["start", "stop", "destroy"]);
    destroy.mockRestore();
  });
});
