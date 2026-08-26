// @vitest-environment node
/**
 * Which content changes bump the revision, and — the part that matters — which
 * single one does not.
 *
 * An MCP client writes with `expected_revision`, so a content change that does
 * NOT bump lets a client overwrite a snapshot it never saw. `setEditorContent`
 * deliberately skips the bump when `fromUserEdit` is false, and that reads like
 * exactly such a hole. It is not, and this file is the argument, because the
 * argument is not visible from the line itself:
 *
 *   - `bumpRevisionIfContentChanged` is ALREADY gated on the content differing,
 *     so the `fromUserEdit` guard has no effect on a no-op re-serialization —
 *     it only takes effect where the text really changed.
 *   - Every OTHER way content enters the store bumps on a real change.
 *     `ingestExternalContent` — the disk-change path — bumps unconditionally,
 *     so an external write can never be silently overwritten.
 *   - `fromUserEdit: false` is reachable only from `useTiptapFlush`, and only
 *     when no `onUpdate` fired since the last flush: auto-save and Save All
 *     call `flushActiveWysiwygNow()` before reading `isDirty`. Any transaction
 *     the user drove sets `userEditPending`, and the programmatic loads that do
 *     not are tagged `preventUpdate` and route through `ingestExternalContent`,
 *     which bumps.
 *
 * So the only unbumped content change is the serializer's canonical re-render
 * of a document nobody edited — lossless by construction, and redone on the
 * next flush if a client writes the pre-render text back.
 *
 * The property worth guarding is therefore not "everything bumps" but "exactly
 * one path does not". A NEW unbumped path is a real hole, and this fails on it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { useDocumentStore } from "../document";
import { useRevisionStore } from "../revision";

const TAB = "tab-revision-coverage";

function revision() {
  return useRevisionStore.getState().getRevision(TAB);
}

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "# original\n", "/a.md");
});

describe("revision bumps on every content change but one", () => {
  it("bumps on a user edit", () => {
    const before = revision();
    useDocumentStore.getState().setContent(TAB, "# edited\n");
    expect(revision()).not.toBe(before);
  });

  it("bumps on an external disk change", () => {
    // The path that actually threatens a client's snapshot: someone else wrote
    // the file. It bumps unconditionally on a real change.
    const before = revision();
    useDocumentStore.getState().ingestExternalContent(TAB, "# from disk\n", "disk-open", {
      filePath: "/a.md",
    });
    expect(revision()).not.toBe(before);
  });

  it("does not bump when an external ingest changes nothing", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "# original\n", "disk-open", {
      filePath: "/a.md",
    });
    const before = revision();
    useDocumentStore.getState().ingestExternalContent(TAB, "# original\n", "disk-open", {
      filePath: "/a.md",
    });
    expect(revision()).toBe(before);
  });

  it("does not bump on a serialization sync — the one documented exception", () => {
    const before = revision();
    useDocumentStore.getState().setContent(TAB, "# original\n\n", { fromUserEdit: false });
    expect(revision()).toBe(before);
  });

  it("bumps on a user edit made FROM the re-serialized form", () => {
    // The follow-on that makes the exception safe: once the user touches the
    // re-rendered document, the client's snapshot goes stale as it should.
    useDocumentStore.getState().setContent(TAB, "# original\n\n", { fromUserEdit: false });
    const before = revision();
    useDocumentStore.getState().setContent(TAB, "# original\n\nedited\n");
    expect(revision()).not.toBe(before);
  });

  it("keeps `fromUserEdit` from being the thing that suppresses a no-op bump", () => {
    // If the guard were doing that job, a no-op user edit would bump. It does
    // not — `bumpRevisionIfContentChanged` already handles equality — which is
    // why the guard's only effect is on a real change, and why the reasoning
    // above has to carry the weight instead of the flag.
    const before = revision();
    useDocumentStore.getState().setContent(TAB, "# original\n", { fromUserEdit: true });
    expect(revision()).toBe(before);
  });

  it("has exactly one content-writing action that can skip the bump", () => {
    // Enumerated from the store contract rather than recalled: a NEW action
    // that writes `content` is either covered by a case above or shows up here
    // as an unaccounted name, and this fails until someone decides which.
    const contentWriters = ["initDocument", "setContent", "setEditorContent", "ingestExternalContent"];
    const store = useDocumentStore.getState() as unknown as Record<string, unknown>;
    for (const name of contentWriters) {
      expect(typeof store[name], `${name} is missing from the store`).toBe("function");
    }

    const text = readFileSync("src/stores/documentStore/document.ts", "utf8");
    // One call site, guarded by `fromUserEdit`; one unguarded in the external
    // ingest. A third would be a new hole.
    const guarded = text.match(/if \(fromUserEdit\) bumpRevisionIfContentChanged/g) ?? [];
    const calls = text.match(/bumpRevisionIfContentChanged\(/g) ?? [];
    expect(guarded).toHaveLength(1);
    // Definition + guarded call + external-ingest call.
    expect(calls).toHaveLength(3);
  });
});
