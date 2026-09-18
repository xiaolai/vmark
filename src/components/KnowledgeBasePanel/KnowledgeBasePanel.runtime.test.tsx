// WI-FL1.1 — the Knowledge Base panel probes `content_server_runtime` when it
// opens and names what is missing instead of attempting a start that cannot
// succeed. Only the Tauri boundary is mocked; the service, the hook and the
// panel are real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));

import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { useContentServerStore } from "@/stores/contentServerStore";
import type { ContentServerRuntime } from "@/services/contentServer";

const READY: ContentServerRuntime = {
  node: "ready",
  nodePath: "/usr/local/bin/node",
  cli: "ready",
  cliSource: "provisioned",
  detail: null,
};
const runtime = (over: Partial<ContentServerRuntime>): ContentServerRuntime => ({
  ...READY,
  ...over,
});

/** Each `content_server_runtime` call answers with the next report; the last one repeats. */
function probeAnswers(...reports: ContentServerRuntime[]) {
  const queue = [...reports];
  mocks.invoke.mockImplementation((cmd: string) => {
    if (cmd !== "content_server_runtime") {
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(next);
  });
}

function renderPanel(extra: { isDevBuild?: boolean } = {}) {
  const onStart = vi.fn();
  render(
    <KnowledgeBasePanel
      onStart={onStart}
      onStop={vi.fn()}
      onOpenInBrowser={vi.fn()}
      onPreviewSlides={vi.fn()}
      onExportSlides={vi.fn()}
      {...extra}
    />,
  );
  return { onStart };
}

const startButton = () => screen.queryByRole("button", { name: /start knowledge base/i });
const runtimeCalls = () =>
  mocks.invoke.mock.calls.filter(([cmd]) => cmd === "content_server_runtime").length;

beforeEach(() => {
  useContentServerStore.getState().reset();
  mocks.invoke.mockReset();
  mocks.openUrl.mockReset();
  mocks.openUrl.mockResolvedValue(undefined);
});

describe("KnowledgeBasePanel runtime state (WI-FL1.1)", () => {
  it("probes content_server_runtime on open and starts nothing by itself", async () => {
    probeAnswers(READY);
    const { onStart } = renderPanel();
    // While the probe is in flight the panel says so and offers no Start yet.
    expect(screen.getByRole("status")).toHaveTextContent(/checking the runtime/i);
    expect(startButton()).toBeNull();
    await screen.findByRole("button", { name: /start knowledge base/i });
    expect(runtimeCalls()).toBe(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("content_server_start", expect.anything());
    expect(onStart).not.toHaveBeenCalled();
  });

  it("node missing: names Node.js and the login-shell PATH, and offers no Start", async () => {
    probeAnswers(runtime({ node: "missing", nodePath: null, detail: "node not found on PATH" }));
    const { onStart } = renderPanel();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/cannot start on this machine/i);
    expect(alert).toHaveTextContent(/Node\.js/);
    expect(alert).toHaveTextContent(/login-shell PATH/);
    expect(alert).not.toHaveTextContent(/VMARK_CONTENT_SERVER_CLI/);
    expect(startButton()).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  // #1425 was filed as a Linux packaging fault because the copy said "this
  // build", which reads as "this platform's build". No release on any platform
  // carries the content server, and the message has to say so.
  it("cli missing in a packaged build: no release bundles it, on any platform", async () => {
    probeAnswers(runtime({ cli: "missing", cliSource: null, detail: "content-server runtime not provisioned" }));
    renderPanel({ isDevBuild: false });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no vmark release/i);
    expect(alert).toHaveTextContent(/every platform/i);
    expect(alert).not.toHaveTextContent(/this build/i);
    expect(alert).not.toHaveTextContent(/VMARK_CONTENT_SERVER_CLI/);
    expect(alert).not.toHaveTextContent(/Node\.js/);
    expect(startButton()).toBeNull();
  });

  // The Requirements section already documented the packaged-build truth; the
  // reporter never found it, and asked for a clarification that existed.
  it("offers the requirements documentation, and opens it in the browser", async () => {
    probeAnswers(runtime({ cli: "missing", cliSource: null }));
    renderPanel({ isDevBuild: false });
    const alert = await screen.findByRole("alert");
    const link = within(alert).getByRole("button", { name: /knowledge base requirements/i });
    await userEvent.click(link);
    expect(mocks.openUrl).toHaveBeenCalledWith("https://vmark.app/guide/knowledge-base#requirements");
  });

  it("cli missing in development: names VMARK_CONTENT_SERVER_CLI and a provisioned base-kb", async () => {
    probeAnswers(runtime({ cli: "missing", cliSource: null }));
    renderPanel({ isDevBuild: true });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/VMARK_CONTENT_SERVER_CLI/);
    expect(alert).toHaveTextContent(/base-kb/);
    expect(alert).not.toHaveTextContent(/no vmark release/i);
    expect(startButton()).toBeNull();
  });

  it("both missing: lists the content server first, then Node.js", async () => {
    probeAnswers(runtime({ node: "missing", nodePath: null, cli: "missing", cliSource: null }));
    renderPanel({ isDevBuild: false });
    const alert = await screen.findByRole("alert");
    const items = alert.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/no vmark release/i);
    expect(items[1]).toHaveTextContent(/Node\.js/);
    expect(startButton()).toBeNull();
  });

  it("both ready: Start is offered and clicking it attempts the start", async () => {
    probeAnswers(READY);
    const { onStart } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /start knowledge base/i }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Check again re-probes and, once the runtime is ready, offers Start", async () => {
    probeAnswers(runtime({ node: "missing", nodePath: null }), READY);
    renderPanel();
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /check again/i }));
    await screen.findByRole("button", { name: /start knowledge base/i });
    expect(runtimeCalls()).toBe(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a probe that fails keeps the start path and says why", async () => {
    mocks.invoke.mockRejectedValue({ code: "internal", message: "probe did not complete" });
    const { onStart } = renderPanel();
    const note = await screen.findByText(/could not check the runtime/i);
    expect(note).toHaveTextContent(/probe did not complete/);
    await userEvent.click(screen.getByRole("button", { name: /start knowledge base/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("a probe that returns no report is a failed probe, not a ready runtime", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByText(/could not check the runtime/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(startButton()).toBeInTheDocument();
  });

  it("does not show runtime state once the server is running", async () => {
    probeAnswers(runtime({ node: "missing", nodePath: null }));
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    renderPanel();
    expect(await screen.findByTitle(/knowledge base/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("kb-runtime-missing")).toBeNull();
  });
});

// Audit R2 (#626): the probe ran once at mount, so a panel opened while the
// server was running kept that answer for the stopped view it returned to —
// including across a provision, which is what INSTALLS the CLI it reported
// missing.
describe("the probe is re-asked on the way back to stopped (#626)", () => {
  it("offers Start once a run has provided the CLI the first probe missed", async () => {
    probeAnswers(runtime({ cli: "missing", cliSource: null }), READY);
    useContentServerStore.getState().setStarting();
    renderPanel();
    expect(runtimeCalls()).toBe(1);

    useContentServerStore.getState().stop();

    expect(await screen.findByRole("button", { name: /start knowledge base/i })).toBeInTheDocument();
    expect(runtimeCalls()).toBe(2);
  });

  it("does not re-probe while the panel simply sits stopped", async () => {
    probeAnswers(READY);
    renderPanel();
    await screen.findByRole("button", { name: /start knowledge base/i });
    useContentServerStore.getState().setViewMode("graph");
    expect(runtimeCalls()).toBe(1);
  });
});
