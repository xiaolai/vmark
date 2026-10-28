// @vitest-environment node
// WI-AL1.4 — the production provenance sources: one session per open tab and document, registered as the tab's unsaved-provenance source; a store write no collector announced, a reload, a new document key (save-as) and a closed tab each fail closed; stopping the service disposes every session and source.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
vi.mock("@/utils/debug", () => ({ journalWarn: vi.fn() }));

import { useDocumentStore } from "@/stores/documentStore";
import { agentJournalEpochFake } from "@/test/agentJournalEpochFake";
import { freezeUnsavedProvenance } from "../unsavedProvenance";
import { provenanceSessionFor, startProvenanceSessions } from "../provenanceSessions";

type Breaks = { whole: { reason: string; origin: string } | null };
const ins = (at: number, text: string) => [{ fromA: at, toA: at, fromB: at, toB: at + text.length }];
const owner = {};

async function wholeOf(tabId: string, buffer: string): Promise<Breaks["whole"] | "none"> {
  const f = freezeUnsavedProvenance(tabId, buffer);
  if (!f) return "none";
  const named = await f.payload(null);
  if (!named) return "none";
  f.recorded(named.basis);
  return (named.payload as unknown as { body: { breaks: Breaks } }).body.breaks.whole;
}

const store = () => useDocumentStore.getState();
let stop: (() => void) | null = null;

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
});
afterEach(() => {
  stop?.();
  stop = null;
});

describe("provenanceSessions", () => {
  it("opens a session for every tab present at start, on the store's text", () => {
    store().initDocument("t1", "abc", "/a.md");
    stop = startProvenanceSessions();
    expect(provenanceSessionFor("t1")?.text).toBe("abc");
    expect(provenanceSessionFor("missing")).toBeNull();
  });

  it("an edit a collector announced before the store write is certified", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    const s = provenanceSessionFor("t1")!;
    s.attach(owner, s.openView(owner), "source").edit("", ins(0, "hé"), "hé");
    store().setEditorContent("t1", "hé");
    expect(await wholeOf("t1", "hé")).toBeNull();
  });

  it("a store write no collector announced breaks the whole window", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    store().setEditorContent("t1", "中文");
    expect(await wholeOf("t1", "中文")).toEqual({ reason: "snapshotOnly", origin: "store:unobserved-write" });
  });

  it("a reload breaks even at equal text", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    useDocumentStore.setState((st) => ({ documents: { ...st.documents, t1: { ...st.documents.t1, documentId: st.documents.t1.documentId + 1 } } }));
    expect(await wholeOf("t1", "")).toEqual({ reason: "externalReload", origin: "store:document-replaced" });
  });

  it("a new document key (save-as) replaces the session and its source", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    const before = provenanceSessionFor("t1");
    store().setFilePath("t1", "/b.md");
    const after = provenanceSessionFor("t1");
    expect(after).not.toBe(before);
    expect(after?.text).toBe("");
    await before?.idle();
  });

  it("a closed tab disposes its session and unregisters its source", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "x", null);
    const s = provenanceSessionFor("t1")!;
    s.attach(owner, s.openView(owner), "source").edit("x", ins(1, "y"), "xy");
    store().setEditorContent("t1", "xy");
    await s.idle();
    store().removeDocument("t1");
    expect(provenanceSessionFor("t1")).toBeNull();
    expect(freezeUnsavedProvenance("t1", "xy")).toBeNull();
    await s.idle();
    expect(agentJournalEpochFake.openEpoch("tab:main/t1")).toBeNull();
  });

  it("stopping disposes every session and source; a second stop is a no-op", () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "a", null);
    store().initDocument("t2", "b", null);
    stop();
    expect(provenanceSessionFor("t1")).toBeNull();
    expect(freezeUnsavedProvenance("t2", "b")).toBeNull();
    expect(() => stop?.()).not.toThrow();
    stop = null;
  });

  it("unrelated store updates (cursor, selection) leave the window alone", async () => {
    stop = startProvenanceSessions();
    store().initDocument("t1", "", null);
    const s = provenanceSessionFor("t1")!;
    s.attach(owner, s.openView(owner), "source");
    store().setSelectedText("t1", "b");
    expect(await wholeOf("t1", "")).toBeNull();
  });
});
