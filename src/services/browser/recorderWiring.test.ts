// @vitest-environment node
// WI-NB7.1 — recorder event wiring: browser://navigated re-arms + records a nav
// while recording; tab close aborts the recording. Uses the REAL tabRemovalBus
// (mock boundaries, not app state); the recorderSession service is the seam.
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTabRemoved } from "@/stores/tabRemovalBus";

type NavHandler = (event: { payload: unknown }) => void;
let navHandler: NavHandler | null = null;
const unlistenNav = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: NavHandler) => {
    if (name === "browser://navigated") navHandler = handler;
    return Promise.resolve(unlistenNav);
  },
}));

const isRecording = vi.fn<(tabId: string) => boolean>(() => true);
const recordNavigation = vi.fn<(tabId: string, url: string, generation: number) => Promise<void>>(async () => {});
const abortRecorderSession = vi.fn<(tabId: string) => void>();
vi.mock("@/services/workflow/recorderSession", () => ({
  isRecording: (...a: Parameters<typeof isRecording>) => isRecording(...a),
  recordNavigation: (...a: Parameters<typeof recordNavigation>) => recordNavigation(...a),
  abortRecorderSession: (...a: Parameters<typeof abortRecorderSession>) => abortRecorderSession(...a),
}));

import { startRecorderWiring } from "./recorderWiring";

afterEach(() => {
  vi.clearAllMocks();
  navHandler = null;
  isRecording.mockReturnValue(true);
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("startRecorderWiring", () => {
  it("records a navigation and re-arms when the tab is recording", async () => {
    const stop = startRecorderWiring();
    await flush();
    navHandler!({ payload: { tabId: "t1", url: "https://x.test/step2", generation: 7 } });
    expect(recordNavigation).toHaveBeenCalledWith("t1", "https://x.test/step2", 7);
    stop();
  });

  it("ignores navigations on tabs that are not recording", async () => {
    isRecording.mockReturnValue(false);
    const stop = startRecorderWiring();
    await flush();
    navHandler!({ payload: { tabId: "t1", url: "https://x.test/", generation: 2 } });
    expect(recordNavigation).not.toHaveBeenCalled();
    stop();
  });

  it("aborts the recording when the tab is removed (real bus)", () => {
    const stop = startRecorderWiring();
    notifyTabRemoved("doc-1", "t1");
    expect(abortRecorderSession).toHaveBeenCalledWith("t1");
    stop();
  });

  it("stops listening on dispose — a later tab removal does not abort", async () => {
    const stop = startRecorderWiring();
    await flush();
    stop();
    notifyTabRemoved("doc-1", "t9");
    expect(abortRecorderSession).not.toHaveBeenCalled();
    expect(unlistenNav).toHaveBeenCalled();
  });
});
