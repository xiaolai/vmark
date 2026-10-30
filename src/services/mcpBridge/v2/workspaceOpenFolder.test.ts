// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
// open_workspace handler — fail-now -> approve -> AI-retry (plan WI-1.5).
import { describe, it, expect, beforeEach, vi } from "vitest";

const responses: Array<Record<string, unknown>> = [];
// Rust validate_workspace_dir returns the canonical path (or rejects).
const invokeMock = vi.fn(async (_cmd: string, args: { path: string }) => args.path);
// openWorkspaceByPath resolves to whether the sequence completed (M8).
const openWorkspaceByPath = vi.fn(async () => true);
const withReentryGuard = vi.fn(async <T>(_l: string, _k: string, fn: () => Promise<T>) => fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string, { path: string }])) }));
// The access check's readability probe (services/workspaces/workspaceAccess).
const existsMock = vi.fn(async () => true);
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: (...a: unknown[]) => existsMock(...(a as [])) }));
vi.mock("@/services/mcpBridge/utils", () => ({
  respond: async (r: Record<string, unknown>) => { responses.push(r); },
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@/services/workspaces/openWorkspaceByPath", () => ({
  openWorkspaceByPath: (...a: unknown[]) => openWorkspaceByPath(...(a as [])),
  WORKSPACE_TRANSITION_GUARD: "workspace-transition",
}));
vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: (...a: unknown[]) => withReentryGuard(...(a as [string, string, () => Promise<void>])),
}));

import { handleWorkspaceOpenWorkspace as openWorkspaceHandler } from "./workspaceOpenFolder";
import type { McpWriteContext } from "@/services/mcpBridge/writeContext";
import { BRIDGE_OPERATION_FIELDS } from "./generated/bridgeContracts";
import { useWorkspaceApprovalStore } from "@/stores/workspaceApprovalStore";

/** The write context the router builds for a request on one authenticated connection. */
function connection(connectionId: string): McpWriteContext {
  return {
    attribution: {
      principal: { kind: "anonymous" },
      connectionId,
      sessionLabel: null,
      displayName: null,
    },
  };
}
const CLIENT_A = connection("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const CLIENT_B = connection("bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb");

/** Every case below is one client (A) unless it names another. */
function handleWorkspaceOpenWorkspace(
  id: string,
  args: Record<string, unknown>,
  context: McpWriteContext = CLIENT_A,
): Promise<void> {
  return openWorkspaceHandler(id, args, context);
}

beforeEach(() => {
  responses.length = 0;
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) => args.path);
  existsMock.mockResolvedValue(true);
  useWorkspaceApprovalStore.setState({ pending: [], oneShots: [] });
});

describe("handleWorkspaceOpenWorkspace", () => {
  it("rejects a missing folderPath", async () => {
    await handleWorkspaceOpenWorkspace("id1", {});
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INVALID_PATH");
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
  });

  it("rejects a path that Rust validation rejects (not a directory)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("'/a/file.md' is not a directory"));
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/a/file.md" });
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INVALID_PATH");
  });

  it("first call queues approval and fails now (does not open)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect((responses[0].data as { needsApproval?: boolean }).needsApproval).toBe(true);
    // A pending prompt is queued for the UI.
    expect(useWorkspaceApprovalStore.getState().pending).toHaveLength(1);
  });

  it("retry after approval consumes the one-shot and opens under the guard", async () => {
    // First call queues the prompt.
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" });
    // User approves.
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;

    // Retry (same path/window/client) consumes and opens.
    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(withReentryGuard).toHaveBeenCalledWith(
      "main",
      "workspace-transition",
      expect.any(Function),
    );
    expect(openWorkspaceByPath).toHaveBeenCalledWith("/proj", { windowLabel: "main" });
    expect(responses[0].success).toBe(true);
    expect((responses[0].data as { opened?: boolean }).opened).toBe(true);
    // One-shot spent — a second retry would need re-approval.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("a retry without approval fails again (no open)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" });
    responses.length = 0;
    // Retry WITHOUT approving — still needs approval.
    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
  });

  it("a busy transition guard fails BUSY and does NOT consume the grant (M4)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;
    // The guard is held by a concurrent menu transition → callback skipped.
    withReentryGuard.mockImplementationOnce(async () => undefined);

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("BUSY");
    // The one-shot survives so a later retry can still open.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("an internal open failure fails closed (no false success) (M8)", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;
    openWorkspaceByPath.mockResolvedValueOnce(false);

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("INTERNAL");
    // Grant is spent (it authorized one attempt); a fresh approval is required.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("responds RESOURCE_EXHAUSTED when the approval queue is full (M7)", async () => {
    // Saturate the pending queue with distinct requests.
    const store = useWorkspaceApprovalStore.getState();
    for (let i = 0; i < 32; i++) store.requestApproval(`p${i}`, `/full${i}`, "main", "c1");
    responses.length = 0;

    await handleWorkspaceOpenWorkspace("overflow", { folderPath: "/new" });

    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("RESOURCE_EXHAUSTED");
  });
});

// WI-LX1.1 — the in-app approval is a webview dialog, so it cannot by itself
// make Rust grant a folder. A folder nobody chose and the static scope cannot
// read is confirmed in the folder picker Rust shows, opened AT the folder. The
// MCP transport cannot wait for a person, so the retry fails now and the
// one-shot SURVIVES for the retry after the user confirms.
// Codex F-10 — a one-shot is spendable only by the connection that asked for
// it. Every request carries a validated attribution (writeContext.ts), so
// "any connected client can spend a grant another client asked for" is no
// longer a missing input, only a missing check.
describe("the one-shot is bound to the requesting connection (Codex F-10)", () => {
  it("another connection's retry cannot spend the grant, and the grant survives for its owner", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" }, CLIENT_A);
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" }, CLIENT_B);

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect((responses[0].data as { needsApproval?: boolean }).needsApproval).toBe(true);
    // B's attempt queued B's own prompt; A's grant is untouched.
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
    responses.length = 0;

    await handleWorkspaceOpenWorkspace("id3", { folderPath: "/proj" }, CLIENT_A);

    expect(openWorkspaceByPath).toHaveBeenCalledWith("/proj", { windowLabel: "main" });
    expect(responses[0].success).toBe(true);
  });

  it("the pending prompt records the connection it was raised for", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj" }, CLIENT_B);
    expect(useWorkspaceApprovalStore.getState().pending[0]).toMatchObject({
      clientId: CLIENT_B.attribution.connectionId,
    });
  });
});

describe("open_workspace confirms an ungranted folder in the picker (WI-LX1.1)", () => {
  const refused = { code: "permission-denied", message: "not granted" };

  async function approve(path = "/proj"): Promise<void> {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: path });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");
    responses.length = 0;
  }

  // Rust answers `request_workspace_confirmation` once the dialog is on
  // screen; by default it is shown and the user is still deciding.
  function rustAnswers(
    allow: () => Promise<unknown>,
    confirm: () => Promise<unknown> = async () => undefined,
  ): void {
    invokeMock.mockImplementation(async (cmd: string, args: { path: string }) => {
      if (cmd === "allow_workspace_access") return allow() as Promise<string>;
      if (cmd === "request_workspace_confirmation") return confirm() as Promise<string>;
      return args.path;
    });
  }

  it("opens the picker at the folder, keeps the one-shot, and opens nothing yet", async () => {
    await approve();
    rustAnswers(async () => { throw refused; });
    existsMock.mockRejectedValue(new Error("forbidden path: /proj"));

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(invokeMock).toHaveBeenCalledWith("request_workspace_confirmation", { path: "/proj" });
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(responses[0].success).toBe(false);
    expect(String(responses[0].error)).toContain("APPROVAL_REQUIRED");
    expect(String(responses[0].error)).toContain("folder dialog");
    // No approval envelope: the sidecar would replace this message with the
    // generic "ask the user to approve" text, which is not what is needed now.
    expect(responses[0].data).toBeUndefined();
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("opens on the retry after the user picked the folder", async () => {
    await approve();
    rustAnswers(async () => { throw refused; });
    existsMock.mockRejectedValue(new Error("forbidden path: /proj"));
    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });
    responses.length = 0;

    // The pick made Rust record the folder; now it grants it.
    rustAnswers(async () => "/proj");
    await handleWorkspaceOpenWorkspace("id3", { folderPath: "/proj" });

    expect(openWorkspaceByPath).toHaveBeenCalledWith("/proj", { windowLabel: "main" });
    expect(responses[0].success).toBe(true);
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("opens a folder the static scope already reads, with no picker", async () => {
    await approve();
    rustAnswers(async () => { throw refused; });
    existsMock.mockResolvedValue(true);

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("request_workspace_confirmation");
    expect(responses[0].success).toBe(true);
  });

  it("fails closed, keeping the one-shot, when access cannot be checked", async () => {
    await approve();
    rustAnswers(async () => { throw new Error("ipc down"); });

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(String(responses[0].error)).toContain("INTERNAL");
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  // Audit F2 #146 — the handler used to fire the dialog blind and ALWAYS say
  // it had opened one. With another dialog open, or a failed call, the client
  // was told to wait for a dialog that was never shown.
  it("says BUSY, not 'opened a dialog', while another folder dialog is open", async () => {
    await approve();
    rustAnswers(
      async () => { throw refused; },
      async () => { throw { code: "conflict", message: "A folder dialog is already open" }; },
    );
    existsMock.mockRejectedValue(new Error("forbidden path: /proj"));

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(String(responses[0].error)).toContain("BUSY");
    expect(String(responses[0].error)).not.toContain("opened a folder dialog");
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("fails INTERNAL, keeping the one-shot, when the dialog could not be shown", async () => {
    await approve();
    rustAnswers(async () => { throw refused; }, async () => { throw new Error("ipc down"); });
    existsMock.mockRejectedValue(new Error("forbidden path: /proj"));

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(String(responses[0].error)).toContain("INTERNAL");
    expect(String(responses[0].error)).toContain("ipc down");
    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(useWorkspaceApprovalStore.getState().oneShots).toHaveLength(1);
  });

  it("reports a folder that vanished since approval as INVALID_PATH", async () => {
    await approve();
    rustAnswers(async () => { throw { code: "not-found", message: "gone" }; });

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj" });

    expect(openWorkspaceByPath).not.toHaveBeenCalled();
    expect(String(responses[0].error)).toContain("INVALID_PATH");
  });
});

describe("windowLabel is ignored, and that is a security property", () => {
  // Honouring a client-supplied label would let a caller raise the approval
  // dialog in the window the user is looking at while opening the folder in a
  // different one — consent for one thing, effect on another. Rust does not
  // route by windowLabel, so nothing downstream re-checks it.
  //
  // Asserted at SOURCE level rather than by spying: a behavioural spy passes
  // vacuously when the spied function is simply never called, which is the
  // failure mode this repo keeps finding in its own gates. Reading the code is
  // the only check that stays true when the handler is rewritten.
  const handler = readFileSync(join(__dirname, "workspaceOpenFolder.ts"), "utf8");

  it("never reads a windowLabel off the request, under any name for the payload", () => {
    // Any `<something>.windowLabel` is a read: the handler now takes its
    // payload from the parsed contract, so `args.` alone would prove nothing.
    expect(handler).not.toMatch(/\.windowLabel\b/);
  });

  it("the wire contract declares no windowLabel for the operation", () => {
    // The handler reads only what the contract declares, so this is what
    // makes a client-supplied label unreachable rather than merely unread.
    expect(BRIDGE_OPERATION_FIELDS["vmark.workspace.open_workspace"].map((f) => f.name)).toEqual([
      "folderPath",
    ]);
  });

  it("a request that carries one still prompts and opens in the delivering window", async () => {
    await handleWorkspaceOpenWorkspace("id1", { folderPath: "/proj", windowLabel: "doc-9" });
    expect(useWorkspaceApprovalStore.getState().pending[0]).toMatchObject({ windowLabel: "main" });
    useWorkspaceApprovalStore.getState().resolveApproval("id1", "approve");

    await handleWorkspaceOpenWorkspace("id2", { folderPath: "/proj", windowLabel: "doc-9" });

    expect(openWorkspaceByPath).toHaveBeenCalledWith("/proj", { windowLabel: "main" });
  });

  it("binds to the delivering window explicitly", () => {
    expect(handler).toContain("getCurrentWindowLabel()");
  });

  it("the sidecar does not forward it either", () => {
    // Sending a field the handler ignores advertised a parameter that silently
    // did nothing — the defect was the ADVERTISEMENT, not the routing.
    const tool = readFileSync(
      join(__dirname, "../../../../server/mcp/src/tools/workspace.ts"),
      "utf8"
    );
    const openWorkspaceCall = tool.slice(
      tool.indexOf("vmark.workspace.open_workspace"),
      tool.indexOf("vmark.workspace.open_workspace") + 300
    );
    expect(openWorkspaceCall).not.toMatch(/^\s*windowLabel,$/m);
  });
});
