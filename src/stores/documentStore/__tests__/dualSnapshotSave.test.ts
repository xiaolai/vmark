/**
 * The dual-snapshot save contract (WI-1.4).
 *
 * `markSaved` used to take ONE string — the normalized disk bytes — and store
 * them in `savedContent`, which the field contract says holds CANONICAL editor
 * text. That cross-domain write is why the dirty compare had to be "soft"
 * (`softContentEquals`), and the softness had two live costs:
 *
 *   - a CRLF document was re-dirtied by the very next `setContent` (strict
 *     compare, LF content vs CRLF savedContent) and rewritten on every
 *     auto-save interval, forever;
 *   - `softContentEquals` folds one trailing newline, so an edit that only
 *     added or removed the final newline during an in-flight save was read as
 *     clean and silently discarded.
 *
 * The contract is now TWO snapshots, one per domain: `editorSnapshot` (the
 * canonical text handed to the writer — same domain as `content`, so dirty is
 * a strict compare) and `diskSnapshot` (the exact bytes written — the disk
 * domain, for external-change detection and `preserve`).
 *
 * @coordinates-with stores/documentStore/documentState.ts — buildPostSaveState
 * @coordinates-with services/persistence/saveToPath.ts — the primary caller
 * @module stores/documentStore/__tests__/dualSnapshotSave.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { useDocumentStore } from "../document";

const TAB = "tab-dual";

const doc = () => useDocumentStore.getState().documents[TAB];

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "", null);
});

describe("markSaved stores each snapshot in its own domain", () => {
  it("savedContent gets the EDITOR snapshot, lastDiskContent the DISK snapshot", () => {
    const store = useDocumentStore.getState();
    store.setContent(TAB, "a\nb");
    store.markSaved(TAB, { editorSnapshot: "a\nb", diskSnapshot: "a\r\nb" });

    expect(doc().savedContent).toBe("a\nb");
    expect(doc().lastDiskContent).toBe("a\r\nb");
    expect(doc().isDirty).toBe(false);
  });

  it("a no-op editor update AFTER a CRLF save stays clean", () => {
    // The live bug: savedContent held CRLF bytes, setContent strict-compared
    // LF content against them, and the tab re-dirtied on every flush — so a
    // CRLF document was rewritten every auto-save interval forever.
    const store = useDocumentStore.getState();
    store.setContent(TAB, "a\nb");
    store.markSaved(TAB, { editorSnapshot: "a\nb", diskSnapshot: "a\r\nb" });

    store.setContent(TAB, "a\nb"); // the RAF-debounced flush re-sets identical content
    expect(doc().isDirty).toBe(false);
  });

  it("TOCTOU: an edit landing mid-save leaves the tab dirty", () => {
    const store = useDocumentStore.getState();
    store.setContent(TAB, "edited during save");
    store.markSaved(TAB, { editorSnapshot: "original", diskSnapshot: "original" });
    expect(doc().isDirty).toBe(true);
  });

  it("TOCTOU: a FINAL-NEWLINE-ONLY edit mid-save is still an edit", () => {
    // softContentEquals folded one trailing newline, so this exact edit was
    // read as clean and the user's keystroke silently vanished on save.
    const store = useDocumentStore.getState();
    store.setContent(TAB, "text\n");
    store.markSaved(TAB, { editorSnapshot: "text", diskSnapshot: "text" });
    expect(doc().isDirty).toBe(true);
  });

  it("marking twice with identical snapshots is a no-op", () => {
    const store = useDocumentStore.getState();
    store.setContent(TAB, "x");
    store.markSaved(TAB, { editorSnapshot: "x", diskSnapshot: "x" });
    const before = doc();
    store.markSaved(TAB, { editorSnapshot: "x", diskSnapshot: "x" });
    expect(doc().savedContent).toBe(before.savedContent);
    expect(doc().lastDiskContent).toBe(before.lastDiskContent);
    expect(doc().isDirty).toBe(false);
  });

  it("clears isDivergent — a successful save supersedes the divergence", () => {
    const store = useDocumentStore.getState();
    store.setContent(TAB, "x");
    store.markDivergent(TAB);
    store.markSaved(TAB, { editorSnapshot: "x", diskSnapshot: "x" });
    expect(doc().isDivergent).toBe(false);
  });
});

describe("markAutoSaved is markSaved plus a timestamp", () => {
  // The comment at useAutoSave.ts:9 claimed auto-save "clears dirty without
  // touching savedContent". The code never did that, and it would be WRONG:
  // an auto-save writes the current content to disk, so that content IS the
  // saved baseline. The real difference is exactly one field.
  it("moves savedContent like a real save — because it IS one", () => {
    const store = useDocumentStore.getState();
    store.setContent(TAB, "auto");
    store.markAutoSaved(TAB, { editorSnapshot: "auto", diskSnapshot: "auto\r\n" });
    expect(doc().savedContent).toBe("auto");
    expect(doc().lastDiskContent).toBe("auto\r\n");
    expect(doc().isDirty).toBe(false);
    expect(doc().lastAutoSave).not.toBeNull();
  });
});

describe("structural gate: no caller passes a bare string", () => {
  // TypeScript enforces the object shape at compile time; this catches the
  // one thing it cannot — a caller casting or a stale .js file — by scanning
  // the production sources for a string-literal second argument.
  it("no production markSaved/markAutoSaved call has a string second argument", () => {
    const root = join(__dirname, "../../..");
    const offenders: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (!name.includes("node_modules") && !name.includes("__tests__")) visit(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue;
        const src = readFileSync(p, "utf8");
        if (/mark(?:Auto)?Saved\(\s*[^,)]+,\s*["'`]/.test(src)) offenders.push(p);
      }
    };
    visit(root);
    expect(offenders).toEqual([]);
  });
});
