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
    useDocumentStore.getState().setContent("t1", "![](./assets/images/pasted.png)");

    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });

  it("omits the excluded tabs", () => {
    useDocumentStore.getState().initDocument("t1", "A", "/tmp/a.md");
    useDocumentStore.getState().initDocument("t2", "B", "/tmp/b.md");

    const live = liveContentsExcluding(new Set(["t1"]));

    expect(live.has("/tmp/a.md")).toBe(false);
    expect(live.get("/tmp/b.md")).toBe("B");
  });

  it("omits untitled documents (they have no assets folder of their own)", () => {
    useDocumentStore.getState().initDocument("t1", "draft", null);
    expect(liveContentsExcluding().size).toBe(0);
  });

  it("prefers the dirty buffer when two tabs hold one path", () => {
    useDocumentStore.getState().initDocument("clean", "saved", "/tmp/a.md");
    useDocumentStore.getState().initDocument("dirty", "saved", "/tmp/a.md");
    useDocumentStore.getState().setContent("dirty", "![](./assets/images/pasted.png)");

    // Whichever order the store iterates, the buffer carrying the extra
    // reference must win — the clean twin would leave that image unprotected.
    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });

  it("keeps the dirty buffer even when the clean twin comes last", () => {
    useDocumentStore.getState().initDocument("dirty", "saved", "/tmp/a.md");
    useDocumentStore.getState().setContent("dirty", "![](./assets/images/pasted.png)");
    useDocumentStore.getState().initDocument("clean", "saved", "/tmp/a.md");

    expect(liveContentsExcluding().get("/tmp/a.md")).toBe("![](./assets/images/pasted.png)");
  });
});
