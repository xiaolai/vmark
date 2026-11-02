/**
 * CliProviderList — the detected CLI rows and the notice that separates "this
 * CLI is not installed" from "VMark could not read your shell's PATH" (#1628):
 * the notice appears only while a fallback is in effect and a CLI is missing,
 * and a Detect that recovers clears it.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { CliProviderList } from "./CliProviderList";
import { useAiProviderStore } from "@/stores/aiStore";
import type { CliProviderInfo } from "@/types/aiGenies";

const claude: CliProviderInfo = { type: "claude", name: "Claude", command: "claude", available: true, path: "/x/claude" };
const codex: CliProviderInfo = { type: "codex", name: "Codex", command: "codex", available: false };

const timedOut = { shell: "zsh", reason: "timeout", path: "/usr/bin:/bin" };

function stubFallback(fallback: unknown) {
  invoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd === "login_path_fallback" ? fallback : undefined)
  );
}

async function renderList(providers: CliProviderInfo[]) {
  useAiProviderStore.setState({ cliProviders: providers, detecting: false, activeProvider: null });
  const view = render(<CliProviderList />);
  await act(async () => {});
  return view;
}

const notice = () => screen.queryByRole("status");

beforeEach(() => {
  invoke.mockReset();
  stubFallback(null);
});

describe("CliProviderList — rows", () => {
  it("renders nothing before any scan has reported a provider", async () => {
    stubFallback(timedOut);
    await renderList([]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(notice()).toBeNull();
  });

  it("marks each CLI Available or Not found", async () => {
    await renderList([claude, codex]);
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("clicking an available row activates it; a missing one does not", async () => {
    await renderList([claude, codex]);
    await act(async () => screen.getByText("Codex").click());
    expect(useAiProviderStore.getState().activeProvider).toBeNull();
    await act(async () => screen.getByText("Claude").click());
    expect(useAiProviderStore.getState().activeProvider).toBe("claude");
  });
});

describe("CliProviderList — PATH fallback notice", () => {
  it("names the shell, the reason and the PATH actually searched", async () => {
    stubFallback(timedOut);
    await renderList([claude, codex]);
    expect(notice()).toHaveTextContent("zsh");
    expect(notice()).toHaveTextContent("timed out");
    expect(notice()).toHaveTextContent("/usr/bin:/bin");
  });

  it.each([
    ["spawn", "could not start"],
    ["exit", "exited with an error"],
    ["timeout", "timed out"],
    ["noPath", "reported no PATH"],
  ])("words the %s reason", async (reason, words) => {
    stubFallback({ ...timedOut, reason });
    await renderList([codex]);
    expect(notice()).toHaveTextContent(words);
  });

  it("omits the PATH line when the inherited PATH is empty", async () => {
    stubFallback({ ...timedOut, path: "" });
    await renderList([codex]);
    expect(notice()).toBeInTheDocument();
    expect(notice()?.querySelector("code")).toBeNull();
  });

  it("stays quiet when the login shell's PATH was read", async () => {
    await renderList([claude, codex]);
    expect(notice()).toBeNull();
  });

  it("stays quiet when every CLI was found anyway", async () => {
    stubFallback(timedOut);
    await renderList([claude]);
    expect(notice()).toBeNull();
  });

  it("clears once a later scan recovers", async () => {
    stubFallback(timedOut);
    await renderList([codex]);
    expect(notice()).toBeInTheDocument();

    stubFallback(null);
    await act(async () => useAiProviderStore.setState({ detecting: true }));
    await act(async () => useAiProviderStore.setState({ detecting: false }));
    expect(notice()).toBeNull();
  });

  it("does not read the status while a scan is still running", async () => {
    useAiProviderStore.setState({ cliProviders: [codex], detecting: true, activeProvider: null });
    render(<CliProviderList />);
    await act(async () => {});
    expect(invoke).not.toHaveBeenCalledWith("login_path_fallback");
  });

  it("a late answer from before a rescan cannot bring the notice back", async () => {
    let answerStale: (value: unknown) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((resolve) => { answerStale = resolve; }));
    await renderList([codex]);

    stubFallback(null);
    await act(async () => useAiProviderStore.setState({ detecting: true }));
    await act(async () => useAiProviderStore.setState({ detecting: false }));
    await act(async () => answerStale(timedOut));
    expect(notice()).toBeNull();
  });

  it("a failed status read leaves the rows and shows no notice", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("ipc down")));
    await renderList([codex]);
    expect(notice()).toBeNull();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });
});
