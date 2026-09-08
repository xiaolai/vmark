// WI-FL5.8 — useLiveDocsResponder: this window's half of the cross-window
// image-reference census (ledger F7, live-docs / WI-9). A window that does not
// answer makes the requester's collection INCOMPLETE and it then deletes
// nothing — so the hook must answer every request, with an EMPTY set when it
// has nothing, and never with the buffers themselves.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { extractImageReferenceKeys } from "@/utils/imageReferences";
import { useLiveDocsResponder } from "./useLiveDocsResponder";

type RequestHandler = (event: { payload: string }) => void;

const bridge = vi.hoisted(() => ({
  handler: null as RequestHandler | null,
  unlisten: vi.fn(),
  label: "main",
  events: [] as string[],
  listenPromise: null as Promise<() => void> | null,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: bridge.label,
    listen: (event: string, handler: RequestHandler) => {
      bridge.events.push(event);
      bridge.handler = handler;
      return bridge.listenPromise ?? Promise.resolve(bridge.unlisten);
    },
  }),
}));

const mockInvoke = vi.mocked(invoke);

function openDocument(content: string, filePath: string | null): string {
  const tabId = useTabStore.getState().createTab("main", filePath);
  useDocumentStore.getState().initDocument(tabId, content, filePath);
  return tabId;
}

async function request(requestId: string) {
  await act(async () => {
    bridge.handler?.({ payload: requestId });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function answer() {
  const call = mockInvoke.mock.calls.find((c) => c[0] === "live_docs_response");
  return call?.[1] as { requestId: string; label: string; refs: string[] } | undefined;
}

beforeEach(() => {
  mockInvoke.mockReset().mockResolvedValue(undefined);
  bridge.handler = null;
  bridge.events = [];
  bridge.label = "main";
  bridge.listenPromise = null;
  bridge.unlisten.mockClear();
  useTabStore.setState({ tabs: {}, activeTabId: {}, lastActiveBrowserPageId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useLiveDocsResponder", () => {
  it("subscribes to live-docs:request on the current window", () => {
    renderHook(() => useLiveDocsResponder());
    expect(bridge.events).toEqual(["live-docs:request"]);
  });

  it("answers with its own label and the union of reference KEYS across every open buffer — deduplicated, never the content", async () => {
    const a = "![one](./img/one.png)\n\n![again](img/one.png)";
    const b = "Text with ![two](assets/two.PNG?v=2) and a repeat ![one](./img/one.png)";
    openDocument(a, "/ws/a.md");
    openDocument(b, "/ws/b.md");
    bridge.label = "doc-2";
    renderHook(() => useLiveDocsResponder());

    await request("req-1");

    const sent = answer();
    expect(sent?.requestId).toBe("req-1");
    expect(sent?.label).toBe("doc-2");
    const expected = new Set<string>([...extractImageReferenceKeys(a), ...extractImageReferenceKeys(b)]);
    expect(new Set(sent?.refs)).toEqual(expected);
    expect(sent?.refs).toHaveLength(expected.size); // no duplicates on the wire
    expect(sent?.refs.some((key) => key.includes("one.png"))).toBe(true);
    expect(sent?.refs.some((key) => key.includes("two.png"))).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("Text with"); // keys travel, buffers do not
  });

  it("with no documents it STILL answers — with an empty set — so the requester's census stays complete", async () => {
    renderHook(() => useLiveDocsResponder());

    await request("req-empty");

    expect(answer()).toEqual({ requestId: "req-empty", label: "main", refs: [] });
  });

  it("an untitled, never-saved buffer counts too — nothing on disk could vouch for its references", async () => {
    openDocument("![draft](/abs/draft.png)", null);
    renderHook(() => useLiveDocsResponder());

    await request("req-untitled");

    expect(answer()?.refs.some((key) => key.includes("draft.png"))).toBe(true);
  });

  it("answers every request separately, each with its own id", async () => {
    renderHook(() => useLiveDocsResponder());

    await request("first");
    await request("second");

    const ids = mockInvoke.mock.calls
      .filter((c) => c[0] === "live_docs_response")
      .map((c) => (c[1] as { requestId: string }).requestId);
    expect(ids).toEqual(["first", "second"]);
  });

  it("a failed answer is logged rather than thrown — the requester fails closed on its own", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("relay gone"));
    renderHook(() => useLiveDocsResponder());

    await expect(request("req-fail")).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[OrphanCleanup]"),
      expect.stringContaining("live-docs response failed"),
      expect.any(Error),
    );
  });

  it("unmounting unsubscribes", async () => {
    const { unmount } = renderHook(() => useLiveDocsResponder());
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
  });

  it("unmounting BEFORE the subscription resolved still unsubscribes once it does", async () => {
    let resolveListen!: (fn: () => void) => void;
    bridge.listenPromise = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    const { unmount } = renderHook(() => useLiveDocsResponder());

    unmount();
    expect(bridge.unlisten).not.toHaveBeenCalled();

    await act(async () => {
      resolveListen(bridge.unlisten);
      await Promise.resolve();
    });
    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
  });
});
