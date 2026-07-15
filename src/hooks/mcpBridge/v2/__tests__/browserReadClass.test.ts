// WI-P1.2 (audit #8) — shared read-class executor + human-attachment gate,
// extracted to a neutral module so `read` and `screenshot` no longer duplicate
// the flow and browser.ts ↔ browserScreenshot.ts is no longer a dependency cycle.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { respond } from "../../utils";
import { requireHumanAttachment, runReadClass } from "../browserReadClass";
import { resolveBrowserTab } from "../browserHelpers";
import { useTabStore } from "@/stores/tabStore";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";

const SITE = "https://x.example.com/p";

function seed(mode: "ai-sandbox" | "human" = "ai-sandbox"): string {
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
  return useTabStore.getState().createBrowserTab("main", SITE, "X", mode);
}
function lastResponse() {
  const calls = vi.mocked(respond).mock.calls;
  return calls[calls.length - 1][0];
}
/** A trivial read-class op: echoes the invoke result into the response data. */
const echoOp = {
  invoke: () => invoke("op_invoke"),
  data: (_tab: ReturnType<typeof resolveBrowserTab>, r: unknown) => ({ echo: r }),
};

beforeEach(() => {
  invoke.mockReset();
  vi.mocked(respond).mockClear();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
  useSettingsStore.getState().updateBrowserSetting("enabled", true);
});

describe("requireHumanAttachment", () => {
  it("allows a non-human (AI) tab without a prompt", async () => {
    const id = seed("ai-sandbox");
    const tab = resolveBrowserTab(id);
    expect(await requireHumanAttachment("r", tab)).toBe(true);
    expect(vi.mocked(respond)).not.toHaveBeenCalled();
  });

  it("refuses an unattached human tab, queues an attach approval, and awaits the response", async () => {
    const id = seed("human");
    const tab = resolveBrowserTab(id);
    expect(await requireHumanAttachment("r", tab)).toBe(false);
    expect(lastResponse()).toMatchObject({ error: "ATTACHMENT_REQUIRED" });
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ operation: "attach", tabId: id });
  });

  it("allows an attached human tab", async () => {
    const id = seed("human");
    useBrowserApprovalStore.setState({
      grants: [], pending: [], oneShots: [],
      attachments: [{ tabId: id, generation: 0, once: true }],
    });
    const tab = resolveBrowserTab(id);
    expect(await requireHumanAttachment("r", tab)).toBe(true);
  });
});

describe("runReadClass", () => {
  it("fails closed when the browser is disabled", async () => {
    useSettingsStore.getState().updateBrowserSetting("enabled", false);
    seed();
    await runReadClass("d", {}, echoOp);
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });

  it("runs the op on an AI tab and responds with its data", async () => {
    const id = seed();
    invoke.mockResolvedValue("RESULT");
    await runReadClass("r1", { tabId: id }, echoOp);
    expect(invoke).toHaveBeenCalledWith("op_invoke");
    expect(lastResponse()).toMatchObject({ id: "r1", success: true, data: { echo: "RESULT" } });
  });

  it("rejects an empty tabId instead of using the active tab", async () => {
    seed();
    await runReadClass("e", { tabId: "" }, echoOp);
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  it("errors when the tab is not a browser tab", async () => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0, closedTabs: {} });
    const docId = useTabStore.getState().createTab("main", "/a.md");
    await runReadClass("doc", { tabId: docId }, echoOp);
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ success: false });
  });

  it("requires attachment on a human tab and does not run the op", async () => {
    const id = seed("human");
    await runReadClass("h", { tabId: id }, echoOp);
    expect(invoke).not.toHaveBeenCalled();
    expect(lastResponse()).toMatchObject({ error: "ATTACHMENT_REQUIRED" });
  });

  it("runs the op on an attached human tab and consumes the attachment", async () => {
    const id = seed("human");
    useBrowserApprovalStore.setState({
      grants: [], pending: [], oneShots: [],
      attachments: [{ tabId: id, generation: 0, once: true }],
    });
    invoke.mockResolvedValue("OK");
    await runReadClass("h2", { tabId: id }, echoOp);
    expect(lastResponse()).toMatchObject({ id: "h2", success: true });
    expect(useBrowserApprovalStore.getState().attachments).toEqual([]);
  });
});
