// @vitest-environment node
/**
 * EXTERNAL text entering a document, and what it is allowed to decide.
 *
 * The counterpart to `setEditorContent`: that action asserts its input is
 * already canonical, this one MAKES it canonical and records what the source
 * looked like on the way in. Splitting them is what lets the keystroke path
 * skip the scan entirely (WI-1.2).
 *
 * The metadata half is WI-1.3: which ingress gets to define the document's
 * line-ending convention. Deriving it from whatever string is being written is
 * right for a disk read and wrong for the other four origins — the hot-exit
 * case most damagingly, because the persisted body is already LF and re-deriving
 * turns a CRLF user's file into an LF file on the next save.
 *
 * WI-1.2 — split the store API (external-ingress half)
 * WI-1.3 — metadata precedence per ingress origin
 *
 * @coordinates-with stores/documentStore/document.ts
 * @coordinates-with utils/ingestOrigin.ts — the precedence table
 * @coordinates-with utils/editorText.ts — canonicalisation and BOM policy
 * @module stores/documentStore/__tests__/ingestExternalContent.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";

const TAB = "tab-ingest";
const BOM = "﻿";

const doc = (tabId = TAB) => useDocumentStore.getState().documents[tabId];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "", null);
});

describe("ingestExternalContent — canonicalisation", () => {
  it("stores LF content while keeping the raw bytes as the disk snapshot", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\r\nb\r\n", "disk-open");
    expect(doc()?.content).toBe("a\nb\n");
    expect(doc()?.lastDiskContent).toBe("a\r\nb\r\n");
  });

  it("strips a leading BOM from content and records it as a flag", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, `${BOM}a\r\nb`, "disk-open");
    expect(doc()?.content).toBe("a\nb");
    expect(doc()?.hasBom).toBe(true);
  });

  it("keeps the BOM in lastDiskContent so a save can re-emit the exact bytes", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, `${BOM}a\r\nb`, "disk-open");
    expect(doc()?.lastDiskContent).toBe(`${BOM}a\r\nb`);
  });

  it("reports hasBom false when there is none", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\nb", "disk-open");
    expect(doc()?.hasBom).toBe(false);
  });

  it("treats a BOM that is not at offset 0 as ordinary content", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, `a${BOM}b`, "disk-open");
    expect(doc()?.content).toBe(`a${BOM}b`);
    expect(doc()?.hasBom).toBe(false);
  });

  it("clears a previously-set hasBom when the new text has none", () => {
    // Reloading a file that lost its BOM must not leave the flag set, or the
    // next save re-adds a mark the file no longer has.
    const store = useDocumentStore.getState();
    store.ingestExternalContent(TAB, `${BOM}a`, "disk-open");
    store.ingestExternalContent(TAB, "a", "disk-open");
    expect(doc()?.hasBom).toBe(false);
  });

  it.each([
    { label: "empty", raw: "" },
    { label: "whitespace only", raw: "   " },
    { label: "a single CRLF", raw: "\r\n" },
    { label: "no trailing newline", raw: "a\r\nb" },
    { label: "lone CR", raw: "a\rb" },
  ])("leaves no carriage return in content for $label", ({ raw }) => {
    useDocumentStore.getState().ingestExternalContent(TAB, raw, "disk-open");
    expect(doc()?.content).not.toContain("\r");
  });

  it("marks the document clean — ingested text IS the saved state", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\r\nb", "disk-open");
    expect(doc()?.isDirty).toBe(false);
    expect(doc()?.savedContent).toBe("a\nb");
  });

  it("a missing tab: baseline origins CREATE, edit origins no-op", () => {
    // The keyed-update no-op rule holds for edits; a baseline ingest IS the
    // document, so it creates (see the routing-options suite).
    useDocumentStore.getState().ingestExternalContent("no-such-tab", "x", "mcp-write");
    expect(doc("no-such-tab")).toBeUndefined();
    useDocumentStore.getState().ingestExternalContent("no-such-tab", "x", "disk-open");
    expect(doc("no-such-tab")?.content).toBe("x");
  });
});

describe("ingestExternalContent — metadata precedence (WI-1.3)", () => {
  it("disk-open derives the convention from the disk text", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\r\nb", "disk-open");
    expect(doc()?.lineEnding).toBe("crlf");
  });

  it("crash-recovery derives from the snapshot body", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\r\nb", "crash-recovery");
    expect(doc()?.lineEnding).toBe("crlf");
  });

  // The defect this item exists for: the persisted body was canonicalised to LF
  // before being written, so deriving from it answers "lf" and the next
  // `preserve` save rewrites the user's CRLF file.
  it("hot-exit-restore keeps persisted crlf even though the restored body is LF", () => {
    useDocumentStore
      .getState()
      .ingestExternalContent(TAB, "a\nb", "hot-exit-restore", { persisted: { lineEnding: "crlf" } });
    expect(doc()?.lineEnding).toBe("crlf");
  });

  it("hot-exit-restore derives when the persisted value is unknown", () => {
    useDocumentStore
      .getState()
      .ingestExternalContent(TAB, "a\r\nb", "hot-exit-restore", { persisted: { lineEnding: "unknown" } });
    expect(doc()?.lineEnding).toBe("crlf");
  });

  it.each(["mcp-write"] as const)(
    "%s does not redefine the document's disk convention",
    (origin) => {
      const store = useDocumentStore.getState();
      store.ingestExternalContent(TAB, "a\r\nb", "disk-open");
      expect(doc()?.lineEnding).toBe("crlf");

      store.ingestExternalContent(TAB, "x\ny", origin);
      expect(doc()?.lineEnding).toBe("crlf");
    },
  );

  it("mcp-write of a CRLF payload still canonicalises the content it writes", () => {
    // Not redefining the convention is about METADATA. The text itself is still
    // subject to the LF invariant.
    const store = useDocumentStore.getState();
    store.ingestExternalContent(TAB, "a\nb", "disk-open");
    store.ingestExternalContent(TAB, "x\r\ny", "mcp-write");
    expect(doc()?.content).toBe("x\ny");
    expect(doc()?.lineEnding).toBe("lf");
  });

  it("two tabs ingesting different conventions do not cross-contaminate", () => {
    const store = useDocumentStore.getState();
    store.initDocument("tab-a", "", null);
    store.initDocument("tab-b", "", null);

    store.ingestExternalContent("tab-a", "a\r\nb", "disk-open");
    store.ingestExternalContent("tab-b", "a\nb", "disk-open");

    expect(doc("tab-a")?.lineEnding).toBe("crlf");
    expect(doc("tab-b")?.lineEnding).toBe("lf");
  });
});

/**
 * Canonicalising is not the same as declaring the file saved.
 *
 * A disk read IS the saved truth, so it establishes a baseline. A tool write or
 * a paste is an EDIT — it changes the buffer away from what is on disk. Treating
 * all five origins alike marks an AI's unsaved edit clean, and the user then
 * closes the tab with no save prompt and loses it.
 */
describe("ingestExternalContent — snapshot policy", () => {
  it.each(["mcp-write"] as const)("%s leaves the document DIRTY", (origin) => {
    const store = useDocumentStore.getState();
    store.ingestExternalContent(TAB, "original", "disk-open");
    expect(doc()?.isDirty).toBe(false);

    store.ingestExternalContent(TAB, "edited", origin);
    expect(doc()?.content).toBe("edited");
    expect(doc()?.isDirty).toBe(true);
  });

  it.each(["mcp-write"] as const)(
    "%s does not move savedContent — the file on disk has not changed",
    (origin) => {
      const store = useDocumentStore.getState();
      store.ingestExternalContent(TAB, "original", "disk-open");
      store.ingestExternalContent(TAB, "edited", origin);
      expect(doc()?.savedContent).toBe("original");
    },
  );

  it.each(["mcp-write"] as const)(
    "%s does not move lastDiskContent — external-change detection must keep comparing to disk",
    (origin) => {
      const store = useDocumentStore.getState();
      store.ingestExternalContent(TAB, "original\r\n", "disk-open");
      store.ingestExternalContent(TAB, "edited", origin);
      expect(doc()?.lastDiskContent).toBe("original\r\n");
    },
  );

  it("an edit back to the saved text is clean again", () => {
    const store = useDocumentStore.getState();
    store.ingestExternalContent(TAB, "original", "disk-open");
    store.ingestExternalContent(TAB, "edited", "mcp-write");
    store.ingestExternalContent(TAB, "original", "mcp-write");
    expect(doc()?.isDirty).toBe(false);
  });

  it.each(["disk-open", "hot-exit-restore"] as const)(
    "%s establishes a clean baseline",
    (origin) => {
      const store = useDocumentStore.getState();
      store.ingestExternalContent(TAB, "whatever", "disk-open");
      store.ingestExternalContent(TAB, "restored", origin);
      expect(doc()?.isDirty).toBe(false);
      expect(doc()?.savedContent).toBe("restored");
      expect(doc()?.lastDiskContent).toBe("restored");
    },
  );

  // crash-recovery is NOT a baseline, however much it looks like one next to
  // hot-exit-restore. `_crashRecoveryStartup.ts:192` passes `savedContent: ""`
  // deliberately — its comment reads "makes it dirty" — because a recovered
  // snapshot IS unsaved work. Marking it clean means auto-save skips the tab
  // and closing it prompts for nothing, so the crash recovery loses exactly the
  // work it exists to rescue.
  it("crash-recovery leaves the recovered document DIRTY", () => {
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "", null, { savedContent: "" }); // savedContent "" — the real shape
    store.ingestExternalContent(TAB, "recovered work", "crash-recovery");
    expect(doc()?.content).toBe("recovered work");
    expect(doc()?.isDirty).toBe(true);
  });

  it("crash-recovery does not claim the recovered text was ever on disk", () => {
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "", null, { savedContent: "" });
    store.ingestExternalContent(TAB, "recovered work", "crash-recovery");
    expect(doc()?.savedContent).toBe("");
    expect(doc()?.lastDiskContent).toBe("");
  });

  it("crash-recovery still DERIVES metadata from the snapshot body", () => {
    // The two axes are independent: derive the convention, but do not pretend
    // the buffer is saved.
    const store = useDocumentStore.getState();
    store.initDocument(TAB, "", null, { savedContent: "" });
    store.ingestExternalContent(TAB, "a\r\nb", "crash-recovery");
    expect(doc()?.lineEnding).toBe("crlf");
    expect(doc()?.isDirty).toBe(true);
  });

  it("an edit origin still bumps nothing that forces a remount", () => {
    // documentId drives editor remount. A baseline load is a new document; an
    // edit is not, and remounting on every MCP write would destroy undo history.
    const store = useDocumentStore.getState();
    store.ingestExternalContent(TAB, "original", "disk-open");
    const before = doc()?.documentId;
    store.ingestExternalContent(TAB, "edited", "mcp-write");
    expect(doc()?.documentId).toBe(before);
  });

  it("a baseline load DOES bump documentId", () => {
    const store = useDocumentStore.getState();
    const before = doc()?.documentId ?? 0;
    store.ingestExternalContent(TAB, "fresh", "disk-open");
    expect(doc()?.documentId).toBe(before + 1);
  });
});

describe("ingestExternalContent — cross-tab isolation", () => {
  it("two tabs ingesting different conventions do not cross-contaminate", () => {
    const store = useDocumentStore.getState();
    store.initDocument("tab-a", "", null);
    store.initDocument("tab-b", "", null);

    store.ingestExternalContent("tab-a", "a\r\nb", "disk-open");
    store.ingestExternalContent("tab-b", "a\nb", "disk-open");

    expect(doc("tab-a")?.lineEnding).toBe("crlf");
    expect(doc("tab-b")?.lineEnding).toBe("lf");
  });
});

/**
 * The routing options (P0-D): the door must be able to CREATE a document and
 * carry a filePath, or eleven initDocument ingresses cannot route through it.
 * `deriveFrom` exists for hot-exit: the CONTENT loaded is the canonical saved
 * body, but the file's convention, BOM and disk snapshot live in the raw
 * `last_disk_content` — deriving from the body answers "lf" for every file.
 */
describe("ingestExternalContent — routing options", () => {
  it("a baseline origin CREATES the document when the tab has none", () => {
    useDocumentStore.getState().ingestExternalContent("fresh-tab", "a\r\nb", "disk-open", {
      filePath: "/f.md",
    });
    const d = doc("fresh-tab");
    expect(d?.content).toBe("a\nb");
    expect(d?.filePath).toBe("/f.md");
    expect(d?.lineEnding).toBe("crlf");
    expect(d?.isDirty).toBe(false);
  });

  it("an EDIT origin does not create — there is nothing to edit", () => {
    useDocumentStore.getState().ingestExternalContent("ghost-tab", "x", "mcp-write");
    expect(doc("ghost-tab")).toBeUndefined();
  });

  it("filePath moves with a baseline ingest into an existing tab", () => {
    // replaceTabWithFile opens a DIFFERENT file into the same tab; losing the
    // path move meant a later save wrote the new file's content over the old.
    useDocumentStore.getState().initDocument(TAB, "old", "/old.md");
    useDocumentStore.getState().ingestExternalContent(TAB, "new", "disk-open", {
      filePath: "/new.md",
    });
    expect(doc()?.filePath).toBe("/new.md");
  });

  it("omitting filePath keeps the existing one", () => {
    useDocumentStore.getState().initDocument(TAB, "old", "/keep.md");
    useDocumentStore.getState().ingestExternalContent(TAB, "new", "disk-open");
    expect(doc()?.filePath).toBe("/keep.md");
  });

  it("deriveFrom supplies the metadata, BOM and disk snapshot; the text supplies the content", () => {
    const raw = `${BOM}a\r\nb`; // what is on disk
    const savedBody = "a\nb"; // what the snapshot persisted (canonical)
    useDocumentStore.getState().ingestExternalContent(TAB, savedBody, "hot-exit-restore", {
      persisted: { lineEnding: "unknown" },
      deriveFrom: raw,
    });
    expect(doc()?.content).toBe("a\nb");
    expect(doc()?.lineEnding).toBe("crlf"); // derived from the RAW bytes
    expect(doc()?.hasBom).toBe(true);
    expect(doc()?.lastDiskContent).toBe(raw);
  });

  it("persisted metadata still outranks deriveFrom where it is decided", () => {
    useDocumentStore.getState().ingestExternalContent(TAB, "a\nb", "hot-exit-restore", {
      persisted: { lineEnding: "crlf" },
      deriveFrom: "a\nb",
    });
    expect(doc()?.lineEnding).toBe("crlf");
  });
});
