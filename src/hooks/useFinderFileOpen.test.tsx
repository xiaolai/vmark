import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

import { useFinderFileOpen } from "./useFinderFileOpen";

function TestComponent() {
  useFinderFileOpen();
  return null;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
}));

vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: () => null,
  findExistingTabForPath: () => null,
}));

vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(),
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ tabs: { main: [] }, setActiveTab: vi.fn(), updateTabPath: vi.fn() }) },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ loadContent: vi.fn() }) },
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: { getState: () => ({ addFile: vi.fn() }) },
}));

vi.mock("@/utils/linebreakDetection", () => ({
  detectLinebreaks: () => ({ kind: "lf" }),
}));

describe("useFinderFileOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers app:open-file listener before invoking get_pending_file_opens", async () => {
    const unlisten = vi.fn();
    const deferredListen = createDeferred<() => void>();
    listenMock.mockReturnValue(deferredListen.promise);

    invokeMock.mockResolvedValue([]);

    render(<TestComponent />);

    // Effect should start and call listen(), but invoke() must not run until listen() resolves.
    expect(listenMock).toHaveBeenCalledWith("app:open-file", expect.any(Function));
    expect(invokeMock).not.toHaveBeenCalled();

    deferredListen.resolve(unlisten);

    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("get_pending_file_opens");
  });
});

