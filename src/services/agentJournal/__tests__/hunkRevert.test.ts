// WI-AL2.2e — a hunk revert from the review panel (R34 frontend, R31): the prepare names the hunk and the reviewGen the panel rendered and freezes the tab's provenance only on an epoch already armed — with none it arms nothing and its snapshot baseline is answered AMBIGUOUS_REVERT; after a delayed prepare ack the tab is re-verified synchronously and every injection — typing, a net-zero edit, an uncertified editor remount, close and reopen, Save As, an IME composition, the tab's journal life ending under the same session — aborts with nothing applied; a reply bound to another hunk or reviewGen, or whose range runs past the buffer, aborts; the writer's patch is applied exactly and committed; an applied text whose hash is not the reply's postimageHash is reported appliedWithError, never a refusal; a decision is answered as the panel's decision
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { invoke } from "@tauri-apps/api/core";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { agentJournalEpochFake as epochs } from "@/test/agentJournalEpochFake";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import type { DocumentTab } from "@/stores/tabStoreTypes";
import type { PrepareInput } from "../journalClient";
import { releaseTabJournal, resetJournalBases } from "../documentIdentity";
import { provenanceSessionFor, startProvenanceSessions } from "../provenanceSessions";
import type { RevertDecided } from "../revertReplies";
import type { RevertPrepareInput } from "../revertClient";
import { revertHunk } from "../hunkRevert";

const TAB = "t-1";
const KEY = "path:/a.md";
const CMD = "agent_journal_revert_prepare";
const HUNK = { hunkId: "h-1", reviewGen: "7" };
/** The writer's patch: "abc" with `b` replaced by `x`. */
const PATCH = { from: 1, to: 2, insert: "x" };
const hashOf = (text: string) => `sha256-${createHash("sha256").update(text, "utf8").digest("hex")}`;

interface Reply {
  hunk?: string;
  reviewGen?: string;
  postimageHash?: string;
  to?: number;
}

/** Answer the revert prepare through the journal fake, running `during` before the ack. */
function journal(during?: () => void, reply: Reply = {}) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command !== CMD) return undefined;
    return answerPrepare(args, async (fields) => {
      const { hunkId: _h, expectedReviewGen: _g, ...rest } = fields as unknown as RevertPrepareInput;
      const p = await fake.prepareControlledWrite({ ...rest, tool: "revert" } as unknown as PrepareInput);
      during?.();
      const response = {
        doc: p.doc,
        txn: p.txn,
        revision: p.revision,
        generation: p.generation,
        baseline: p.baseline,
        hunk: reply.hunk ?? HUNK.hunkId,
        reviewGen: reply.reviewGen ?? HUNK.reviewGen,
        ...PATCH,
        to: reply.to ?? PATCH.to,
        postimageHash: reply.postimageHash ?? hashOf("axc"),
      };
      return { kind: "prepared", response };
    });
  });
}

const sent = (): RevertPrepareInput[] =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === CMD)
    .map(([, args]) => JSON.parse((args as { payload: string }).payload) as RevertPrepareInput);
const content = () => useDocumentStore.getState().documents[TAB]?.content;
const ops = () => fake.log.map((e) => e.op);
const store = () => useDocumentStore.getState();

const docTab = (filePath: string): DocumentTab => ({ kind: "document", id: TAB, filePath, title: "a", isPinned: false, formatId: "markdown" });

let stop: () => void = () => {};
let editor: Editor | null = null;

beforeEach(() => {
  fake.reset();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(() => Promise.resolve());
  resetJournalBases();
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({ tabs: { main: [docTab("/a.md")] }, activeTabId: { main: TAB }, untitledCounter: 0 });
  store().initDocument(TAB, "abc", "/a.md");
  stop = startProvenanceSessions();
});

afterEach(() => {
  stop();
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor?.destroy();
  editor = null;
});

describe("revertHunk — the applied revert", () => {
  it("prepares the hunk against the tab's buffer, applies the writer's patch and commits it", async () => {
    journal();
    expect(await revertHunk(TAB, HUNK)).toEqual({ status: "applied", durable: true });
    expect(sent()).toEqual([expect.objectContaining({ docKey: KEY, preimage: "abc", hunkId: "h-1", expectedReviewGen: "7" })]);
    expect(content()).toBe("axc");
    expect(fake.doc(KEY).text).toBe("axc");
    expect(ops()).toEqual(["prepare", "commit"]);
  });

  it("an applied text that is not the reply's postimage is applied with an error, never refused", async () => {
    journal(undefined, { postimageHash: hashOf("something else") });
    const out = await revertHunk(TAB, HUNK);
    expect(out).toMatchObject({ status: "appliedWithError" });
    expect(String((out as { error: unknown }).error)).toMatch(/postimage/);
    expect(content()).toBe("axc");
    expect(ops()).toEqual(["prepare", "commit"]);
  });

  it("a tab that is not open refuses nothing and sends nothing", async () => {
    expect(await revertHunk("t-gone", HUNK)).toEqual({ status: "aborted", reason: "closed" });
    expect(sent()).toEqual([]);
  });
});

describe("revertHunk — the synchronous re-verify after a delayed ack", () => {
  const net = () => {
    store().setEditorContent(TAB, "abcd");
    store().setEditorContent(TAB, "abc");
  };
  const remount = () => provenanceSessionFor(TAB)!.attach({}, null, "test:remount");
  const reopen = () => {
    store().removeDocument(TAB);
    store().initDocument(TAB, "abc", "/a.md");
  };
  const saveAs = () => {
    useTabStore.setState({ tabs: { main: [docTab("/b.md")] } });
    store().setFilePath(TAB, "/b.md");
  };
  const compose = () => {
    editor = new Editor({ extensions: [StarterKit], content: "<p>abc</p>" });
    Object.defineProperty(editor.view, "composing", { get: () => true });
    useEditorStore.getState().setTiptapEditor(editor);
    useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
  };

  it.each([
    ["typing", () => store().setEditorContent(TAB, "abcd"), "edited", "abcd"],
    ["a net-zero edit", net, "edited", "abc"],
    ["an uncertified editor remount", remount, "edited", "abc"],
    ["close and reopen", reopen, "closed", "abc"],
    ["Save As", saveAs, "closed", "abc"],
    ["an IME composition", compose, "composing", "abc"],
    ["the tab's journal life ending", () => releaseTabJournal(TAB), "closed", "abc"],
  ] as const)("%s aborts and applies nothing", async (_label, inject, reason, left) => {
    journal(inject);
    expect(await revertHunk(TAB, HUNK)).toEqual({ status: "aborted", reason });
    expect(content()).toBe(left);
    expect(ops()).toEqual(["prepare", "abort"]);
  });

  it.each([
    ["another hunk", { hunk: "h-2" }],
    ["another reviewGen", { reviewGen: "8" }],
    ["a range past the buffer", { to: 4 }],
  ])("a reply bound to %s aborts and applies nothing", async (_label, reply) => {
    journal(undefined, reply);
    expect(await revertHunk(TAB, HUNK)).toEqual({ status: "aborted", reason: "applyRefused" });
    expect(content()).toBe("abc");
    expect(ops()).toEqual(["prepare", "abort"]);
  });
});

describe("revertHunk — provenance and decisions", () => {
  it("with no armed epoch it arms nothing: the baseline is a snapshot, answered AMBIGUOUS_REVERT", async () => {
    journal();
    fake.refuseNextPrepares("AMBIGUOUS_REVERT");
    const out = await revertHunk(TAB, HUNK);
    expect(out).toMatchObject({ status: "refused", refusal: { journalCode: "AMBIGUOUS_REVERT" } });
    expect(sent()[0]).toMatchObject({ baselineProvenance: null });
    await provenanceSessionFor(TAB)!.idle();
    expect(epochs.armEpoch).not.toHaveBeenCalled();
    expect(content()).toBe("abc");
  });

  it("on an epoch already armed it freezes the tab's provenance and names the capture", async () => {
    const session = provenanceSessionFor(TAB)!;
    // A view attaching uncertified breaks the window, and a break arms.
    session.attach({}, null, "test:view");
    await session.idle();
    expect(epochs.armEpoch).toHaveBeenCalledTimes(1);
    journal();
    expect(await revertHunk(TAB, HUNK)).toEqual({ status: "applied", durable: true });
    expect(sent()[0].capture).toEqual(expect.objectContaining({ view: `main/${TAB}` }));
    expect(epochs.armEpoch).toHaveBeenCalledTimes(1);
  });

  it("a decision is answered as the panel's decision, with nothing applied", async () => {
    const decided: RevertDecided = { doc: "d", hunk: "h-1", action: "conflicted", reviewGen: "8", generation: "5", baseline: null, head: null };
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) =>
      command === CMD ? answerPrepare(args, async () => ({ kind: "decided", response: decided })) : undefined,
    );
    expect(await revertHunk(TAB, HUNK)).toEqual({ status: "decided", decision: decided });
    expect(content()).toBe("abc");
    expect(ops()).toEqual([]);
  });
});
