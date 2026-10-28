// @vitest-environment node
// WI-AL1.7 — "history not recorded" per document: a save or agent write that the journal refused, timed out (JOURNAL_TIMEOUT) or only queued marks its document; a later submission's success clears it, but an OLDER submission settling late never clears or overwrites a newer outcome; documents are independent; Save As (a new key) starts clean; a retired key's entry is removed, its submission order with it; a document whose identity could not be updated stays marked through saves and retirement until it is unmarked
import { describe, it, expect, beforeEach } from "vitest";

import { beginRecordingSubmission, useJournalRecordingStore } from "../journalRecordingStore";

const report = useJournalRecordingStore.getState().report;
const problem = (key: string) => useJournalRecordingStore.getState().docs[key]?.problem ?? null;

beforeEach(() => useJournalRecordingStore.getState().reset());

describe("journalRecordingStore", () => {
  it("numbers submissions in the order they are made", () => {
    const a = beginRecordingSubmission();
    const b = beginRecordingSubmission();
    expect(b).toBeGreaterThan(a);
  });

  it("marks a document whose save timed out, and a later success clears it", () => {
    const s1 = beginRecordingSubmission();
    const s2 = beginRecordingSubmission();
    report("path:/a.md", s1, { kind: "timeout", code: "JOURNAL_TIMEOUT" });
    expect(problem("path:/a.md")).toEqual({ kind: "timeout", code: "JOURNAL_TIMEOUT" });
    report("path:/a.md", s2, null);
    expect(problem("path:/a.md")).toBeNull();
  });

  it("an older success settling after a newer failure does not clear it", () => {
    const first = beginRecordingSubmission();
    const ninth = beginRecordingSubmission();
    report("path:/a.md", ninth, { kind: "refused", code: "JOURNAL_DEGRADED" });
    report("path:/a.md", first, null);
    expect(problem("path:/a.md")).toEqual({ kind: "refused", code: "JOURNAL_DEGRADED" });
  });

  it("an older failure settling after a newer success does not mark the document", () => {
    const old = beginRecordingSubmission();
    const fresh = beginRecordingSubmission();
    report("path:/a.md", fresh, null);
    report("path:/a.md", old, { kind: "queued", code: null });
    expect(problem("path:/a.md")).toBeNull();
  });

  it("keeps documents apart, CJK paths included", () => {
    report("path:/文档.md", beginRecordingSubmission(), { kind: "queued", code: null });
    expect(problem("path:/文档.md")).toEqual({ kind: "queued", code: null });
    expect(problem("path:/a.md")).toBeNull();
  });

  it("a success on a clean document leaves it clean", () => {
    report("path:/a.md", beginRecordingSubmission(), null);
    expect(problem("path:/a.md")).toBeNull();
  });

  it("retire removes a document's entry and keeps the others", () => {
    report("path:/a.md", beginRecordingSubmission(), { kind: "queued", code: null });
    report("path:/b.md", beginRecordingSubmission(), null);
    useJournalRecordingStore.getState().retire("path:/a.md");
    expect(Object.keys(useJournalRecordingStore.getState().docs)).toEqual(["path:/b.md"]);
  });

  it("retiring an unknown key changes nothing", () => {
    report("path:/a.md", beginRecordingSubmission(), null);
    const before = useJournalRecordingStore.getState().docs;
    useJournalRecordingStore.getState().retire("path:/never.md");
    expect(useJournalRecordingStore.getState().docs).toBe(before);
  });

  it("marks a document whose identity could not be updated until it is unmarked, through saves and retirement", () => {
    const { setUnbound, retire } = useJournalRecordingStore.getState();
    setUnbound("path:/文档.md", true);
    report("path:/文档.md", beginRecordingSubmission(), null);
    retire("path:/文档.md");
    expect(useJournalRecordingStore.getState().unbound).toEqual({ "path:/文档.md": true });
    setUnbound("path:/文档.md", false);
    expect(useJournalRecordingStore.getState().unbound).toEqual({});
  });

  it("unmarking a document that is not marked changes nothing", () => {
    const before = useJournalRecordingStore.getState().unbound;
    useJournalRecordingStore.getState().setUnbound("path:/a.md", false);
    expect(useJournalRecordingStore.getState().unbound).toBe(before);
  });
});
