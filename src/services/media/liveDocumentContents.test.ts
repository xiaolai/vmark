// @vitest-environment node
/**
 * The buffers that keep a neighbour's just-pasted image from being deleted.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { liveContentsExcluding } from "./liveDocumentContents";

function reset() {
  const store = useDocumentStore.getState();
  Object.keys(store.documents).forEach((id) => store.removeDocument(id));
}

describe("liveContentsExcluding", () => {
  beforeEach(reset);

  it("is empty when nothing is open", () => {
    expect(liveContentsExcluding().size).toBe(0);
  });

  it("maps every open document by path", () => {
    useDocumentStore.getState().initDocument("t1", "A", "/tmp/a.md");
    useDocumentStore.getState().initDocument("t2", "B", "/tmp/b.md");

    const live = liveContentsExcluding();

    expect(live.get("/tmp/a.md")).toBe("A");
    expect(live.get("/tmp/b.md")).toBe("B");
  });

  it("returns the UNSAVED buffer, not the saved content", () => {
    useDocumentStore.getState().initDocument("t1", "saved", "/tmp/a.md");
    useDocumentStore.getState().setEditorContent("t1", "![](./assets/images/pasted.png)");

    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });

  it("omits the excluded tabs", () => {
    useDocumentStore.getState().initDocument("t1", "A", "/tmp/a.md");
    useDocumentStore.getState().initDocument("t2", "B", "/tmp/b.md");

    const live = liveContentsExcluding(new Set(["t1"]));

    expect(live.has("/tmp/a.md")).toBe(false);
    expect(live.get("/tmp/b.md")).toBe("B");
  });

  it("carries untitled documents under a synthetic key", () => {
    // A never-saved buffer can hold an absolute-path reference that exists
    // nowhere on disk — omitting it deleted the image (review finding). The
    // synthetic key never matches a directory filter, so it acts purely as
    // extra reference evidence.
    useDocumentStore.getState().initDocument("t1", "![](/w/assets/images/x.png)", null);
    expect(liveContentsExcluding().get("untitled:t1")).toBe("![](/w/assets/images/x.png)");
  });

  it("prefers the dirty buffer when two tabs hold one path", () => {
    useDocumentStore.getState().initDocument("clean", "saved", "/tmp/a.md");
    useDocumentStore.getState().initDocument("dirty", "saved", "/tmp/a.md");
    useDocumentStore.getState().setEditorContent("dirty", "![](./assets/images/pasted.png)");

    // Whichever order the store iterates, the buffer carrying the extra
    // reference must win — the clean twin would leave that image unprotected.
    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });

  it("keeps the dirty buffer even when the clean twin comes last", () => {
    useDocumentStore.getState().initDocument("dirty", "saved", "/tmp/a.md");
    useDocumentStore.getState().setEditorContent("dirty", "![](./assets/images/pasted.png)");
    useDocumentStore.getState().initDocument("clean", "saved", "/tmp/a.md");

    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });
});

// WI-10 — the editor syncs to the store on a DEBOUNCE. Reading before it
// settles misses the reference of a just-pasted image, exactly when a
// brand-new file has a single reference.
describe("liveContentsExcluding — flushes pending editor state first", () => {
  beforeEach(reset);

  it("sees an edit that was still in the editor's debounce window", async () => {
    const { registerWysiwygFlusher } = await import("@/utils/wysiwygFlush");
    useDocumentStore.getState().initDocument("t1", "old", "/tmp/a.md");
    // The mounted editor holds newer content than the store.
    registerWysiwygFlusher("t1", () => {
      useDocumentStore.getState().setEditorContent("t1", "![](./assets/images/pasted.png)");
    });

    const live = liveContentsExcluding();

    expect(live.get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
    registerWysiwygFlusher("t1", null);
  });

  it("survives a throwing flusher", async () => {
    const { registerWysiwygFlusher } = await import("@/utils/wysiwygFlush");
    useDocumentStore.getState().initDocument("t1", "content", "/tmp/a.md");
    registerWysiwygFlusher("t1", () => {
      throw new Error("editor already unmounted");
    });

    expect(() => liveContentsExcluding()).not.toThrow();
    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("content");
    registerWysiwygFlusher("t1", null);
  });
});
