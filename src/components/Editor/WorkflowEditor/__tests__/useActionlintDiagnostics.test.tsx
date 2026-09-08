// WI-FL3.8 — useActionlintDiagnostics: actionlint's findings reach the
// workbench's DiagnosticsBanner when `advanced.workflowActionlint` is on.
//
// The hook is driven through the REAL `lintWithActionlint` and the Tauri
// `invoke` boundary, using the wire shapes the Rust `gha_lint` command emits
// (`ok` / `binary_missing` / `failed`), so the GHA-ACTIONLINT-<rule>
// translation is exercised rather than restated by a mock. Only two
// boundaries are faked: `@tauri-apps/api/core` and the toast surface. The
// stores are real (WI-18 mock-boundary policy): the setting is flipped with
// setState and the document is seeded with initDocument.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, infoMock, warningMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  infoMock: vi.fn(),
  warningMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/services/ime/imeToast", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/ime/imeToast")>();
  return {
    ...original,
    imeToast: { ...original.imeToast, info: infoMock, warning: warningMock },
  };
});

import { __resetActionlintPathCacheForTests } from "@/lib/ghaWorkflow/lint/actionlint";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  ACTIONLINT_DEBOUNCE_MS,
  ACTIONLINT_TIMEOUT_MS,
  __resetActionlintNoticesForTests,
  useActionlintDiagnostics,
} from "../useActionlintDiagnostics";

const YAML = [
  "name: ci",
  "on: push",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: pnpm test",
  "",
].join("\n");

// Wire shapes of the Rust `LintResult` enum, verbatim.
const OK_ONE = {
  kind: "ok",
  diagnostics: [
    {
      message: "shellcheck reported issue",
      kind: "shellcheck",
      line: 5,
      column: 7,
      end_line: 5,
      end_column: 12,
    },
  ],
};
const OK_NONE = { kind: "ok", diagnostics: [] };
const MISSING = { kind: "binary_missing" };
const FAILED = { kind: "failed", message: "actionlint exited with status 2" };

const EXPECTED_ROW = {
  severity: "warning",
  code: "GHA-ACTIONLINT-shellcheck",
  message: "shellcheck reported issue",
  position: { startLine: 5, startCol: 7, endLine: 5, endCol: 12 },
};

const initialAdvanced = useSettingsStore.getState().advanced;

/** `get_login_shell_path` (the wrapper's first IPC) then `gha_lint`. */
function lintReplies(reply: unknown): void {
  invokeMock.mockImplementation((cmd: string) =>
    cmd === "gha_lint"
      ? Promise.resolve(reply)
      : Promise.resolve("/opt/homebrew/bin"),
  );
}

const lintCalls = () =>
  invokeMock.mock.calls.filter(([cmd]) => cmd === "gha_lint");

function lintedYaml(callIndex: number): string {
  const args = lintCalls()[callIndex][1] as { yaml: string };
  return args.yaml;
}

function setActionlint(on: boolean): void {
  act(() => {
    useSettingsStore.setState({
      advanced: {
        ...useSettingsStore.getState().advanced,
        workflowActionlint: on,
      },
    });
  });
}

function seedDocument(tabId: string, content: string): void {
  useDocumentStore
    .getState()
    .initDocument(tabId, content, `/repo/.github/workflows/${tabId}.yml`);
}

function editDocument(tabId: string, content: string): void {
  act(() => {
    useDocumentStore.getState().setEditorContent(tabId, content);
  });
}

/** Let the debounce elapse, then drain the two IPC round-trips that sit
 *  between the timer and the state update (each act() flushes the microtasks
 *  queued since the previous one). */
async function fireDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ACTIONLINT_DEBOUNCE_MS);
  });
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockReset();
  infoMock.mockReset();
  warningMock.mockReset();
  __resetActionlintPathCacheForTests();
  __resetActionlintNoticesForTests();
  useDocumentStore.setState({ documents: {} });
  seedDocument("tab-1", YAML);
  setActionlint(true);
});

afterEach(() => {
  vi.useRealTimers();
  useSettingsStore.setState({ advanced: initialAdvanced });
});

describe("useActionlintDiagnostics — the setting is on", () => {
  it("runs actionlint once the debounce elapses and returns its rows as GHA-ACTIONLINT-<rule> diagnostics", async () => {
    lintReplies(OK_ONE);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    // The parser's rows never wait for actionlint: before the debounce there
    // has been no IPC and the list is empty.
    expect(lintCalls()).toHaveLength(0);
    expect(result.current).toEqual([]);

    await fireDebounce();

    expect(lintCalls()).toHaveLength(1);
    expect(lintedYaml(0)).toBe(YAML);
    expect(result.current).toEqual([EXPECTED_ROW]);
  });

  it("forwards the document text verbatim, CJK included", async () => {
    const cjk = `${YAML}      - run: echo 你好，世界\n`;
    useDocumentStore.setState({ documents: {} });
    seedDocument("tab-1", cjk);
    lintReplies(OK_NONE);
    renderHook(() => useActionlintDiagnostics("tab-1"));

    await fireDebounce();

    expect(lintedYaml(0)).toBe(
      useDocumentStore.getState().documents["tab-1"].content,
    );
    expect(lintedYaml(0)).toContain("你好，世界");
  });

  it("collapses rapid edits into one run over the latest text", async () => {
    lintReplies(OK_NONE);
    renderHook(() => useActionlintDiagnostics("tab-1"));
    act(() => {
      vi.advanceTimersByTime(ACTIONLINT_DEBOUNCE_MS / 2);
    });
    editDocument("tab-1", `${YAML}# edit 1\n`);
    act(() => {
      vi.advanceTimersByTime(ACTIONLINT_DEBOUNCE_MS / 2);
    });
    editDocument("tab-1", `${YAML}# edit 2\n`);
    expect(lintCalls()).toHaveLength(0);

    await fireDebounce();

    expect(lintCalls()).toHaveLength(1);
    expect(lintedYaml(0)).toBe(`${YAML}# edit 2\n`);
  });

  it("keeps the previous run's rows while a re-run is pending, then replaces them", async () => {
    lintReplies(OK_ONE);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    expect(result.current).toHaveLength(1);

    lintReplies(OK_NONE);
    editDocument("tab-1", `${YAML}# fixed\n`);
    // Debounce window open: the rows stay put rather than flickering off on
    // every keystroke.
    expect(result.current).toHaveLength(1);

    await fireDebounce();
    expect(result.current).toEqual([]);
  });

  // Audit 20260907 (#290): a superseded run used to be discarded on arrival
  // while its process ran on, so sustained editing accumulated concurrent
  // actionlint processes. Runs are now SERIALIZED per hook: the debounce
  // fires, but a run waits for the in-flight one to settle, and only the
  // latest text runs when it does.
  it("a run superseded while in flight is discarded, and the newer text runs only after it settles", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    let lintCall = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd !== "gha_lint") return Promise.resolve("/opt/homebrew/bin");
      lintCall += 1;
      return lintCall === 1 ? first : Promise.resolve(OK_NONE);
    });
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce(); // run 1 in flight, parked on `first`
    expect(lintCalls()).toHaveLength(1);

    editDocument("tab-1", `${YAML}# newer\n`);
    await fireDebounce(); // debounce elapsed — but run 2 waits for run 1
    expect(lintCalls()).toHaveLength(1);
    expect(result.current).toEqual([]);

    // Run 1 settles LAST, carrying a row that must not appear; run 2 then
    // spawns over the newest text and lands clean.
    await act(async () => {
      resolveFirst(OK_ONE);
    });
    await act(async () => {});
    await act(async () => {});
    expect(lintCalls()).toHaveLength(2);
    expect(lintedYaml(1)).toBe(`${YAML}# newer\n`);
    expect(result.current).toEqual([]);
  });

  it("sustained editing never has two actionlint processes in flight, and only the latest text runs", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    let lintCall = 0;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd !== "gha_lint") return Promise.resolve("/opt/homebrew/bin");
      lintCall += 1;
      return lintCall === 1 ? first : Promise.resolve(OK_ONE);
    });
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    for (let i = 1; i <= 3; i++) {
      editDocument("tab-1", `${YAML}# edit ${i}\n`);
      await fireDebounce();
    }
    expect(lintCalls()).toHaveLength(1);

    await act(async () => {
      resolveFirst(OK_NONE);
    });
    await act(async () => {});
    await act(async () => {});
    expect(lintCalls()).toHaveLength(2);
    expect(lintedYaml(1)).toBe(`${YAML}# edit 3\n`);
    expect(result.current).toEqual([EXPECTED_ROW]);
  });

  it("drops the rows the moment the setting goes off, and lints again when it comes back on", async () => {
    lintReplies(OK_ONE);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    expect(result.current).toHaveLength(1);

    setActionlint(false);
    expect(result.current).toEqual([]);

    setActionlint(true);
    await fireDebounce();
    expect(lintCalls()).toHaveLength(2);
    expect(result.current).toEqual([EXPECTED_ROW]);
  });

  it("switching to another tab drops the previous tab's rows before its own run lands", async () => {
    seedDocument("tab-2", `${YAML}# second file\n`);
    lintReplies(OK_ONE);
    const { result, rerender } = renderHook(
      ({ tabId }: { tabId: string }) => useActionlintDiagnostics(tabId),
      { initialProps: { tabId: "tab-1" } },
    );
    await fireDebounce();
    expect(result.current).toHaveLength(1);

    rerender({ tabId: "tab-2" });
    expect(result.current).toEqual([]);

    await fireDebounce();
    expect(lintCalls()).toHaveLength(2);
    expect(lintedYaml(1)).toBe(`${YAML}# second file\n`);
    expect(result.current).toEqual([EXPECTED_ROW]);
  });

  it("unmounting inside the debounce window cancels the run", async () => {
    lintReplies(OK_ONE);
    const { unmount } = renderHook(() => useActionlintDiagnostics("tab-1"));
    unmount();
    await fireDebounce();
    expect(lintCalls()).toHaveLength(0);
  });
});

describe("useActionlintDiagnostics — nothing to lint", () => {
  it.each<[string, () => void, string | null]>([
    ["the setting is off", () => setActionlint(false), "tab-1"],
    ["there is no hosting tab", () => {}, null],
    ["the tab has no document", () => {}, "no-such-tab"],
    [
      "the document is empty",
      () => {
        useDocumentStore.setState({ documents: {} });
        seedDocument("tab-1", "");
      },
      "tab-1",
    ],
  ])(
    "never calls the lint command and returns an empty list when %s",
    async (_label, arrange, tabId) => {
      lintReplies(OK_ONE);
      arrange();
      const { result } = renderHook(() => useActionlintDiagnostics(tabId));
      await fireDebounce();
      expect(invokeMock).not.toHaveBeenCalled();
      expect(result.current).toEqual([]);
      expect(infoMock).not.toHaveBeenCalled();
      expect(warningMock).not.toHaveBeenCalled();
    },
  );
});

describe("useActionlintDiagnostics — unavailability is said once per session", () => {
  it("binary missing: no rows, one info notice across repeated runs and hook instances", async () => {
    lintReplies(MISSING);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();

    expect(result.current).toEqual([]);
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock.mock.calls[0][0]).toBe(
      "actionlint not found on your PATH — install it for richer workflow diagnostics, or turn it off in Settings → Advanced",
    );
    expect(warningMock).not.toHaveBeenCalled();

    editDocument("tab-1", `${YAML}# edit\n`);
    await fireDebounce();
    seedDocument("tab-2", YAML);
    renderHook(() => useActionlintDiagnostics("tab-2"));
    await fireDebounce();

    expect(lintCalls()).toHaveLength(3);
    expect(infoMock).toHaveBeenCalledTimes(1);
  });

  it("binary failed: no rows, one warning carrying actionlint's own message as the detail line", async () => {
    lintReplies(FAILED);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();

    expect(result.current).toEqual([]);
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock).toHaveBeenCalledWith(
      "actionlint failed to run, so its diagnostics are unavailable",
      { description: "actionlint exited with status 2" },
    );
    expect(infoMock).not.toHaveBeenCalled();

    editDocument("tab-1", `${YAML}# edit\n`);
    await fireDebounce();
    expect(lintCalls()).toHaveLength(2);
    expect(warningMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected lint command counts as a failure: reported once, never thrown", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "gha_lint"
        ? Promise.reject(new Error("IPC channel closed"))
        : Promise.resolve("/opt/homebrew/bin"),
    );
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();

    expect(result.current).toEqual([]);
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock.mock.calls[0][1]).toEqual({
      description: "IPC channel closed",
    });
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("a binary installed mid-session starts producing rows without a second notice", async () => {
    lintReplies(MISSING);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    expect(infoMock).toHaveBeenCalledTimes(1);

    lintReplies(OK_ONE);
    editDocument("tab-1", `${YAML}# after brew install actionlint\n`);
    await fireDebounce();

    expect(result.current).toEqual([EXPECTED_ROW]);
    expect(infoMock).toHaveBeenCalledTimes(1);
  });
  // Audit R2 (#585): the runs are serialized, so ONE call that never settles
  // wedges every later lint behind it — the banner keeps its rows for the rest
  // of the session and nothing says why.
  it("stops waiting on a hung run and lets the next one through", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "gha_lint" ? new Promise(() => {}) : Promise.resolve("/opt/homebrew/bin"),
    );
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    expect(result.current).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(ACTIONLINT_TIMEOUT_MS);
    });
    await act(async () => {});
    expect(warningMock).toHaveBeenCalledTimes(1);

    // The queue moved on: the next edit's run reaches actionlint and lands.
    lintReplies(OK_ONE);
    editDocument("tab-1", `${YAML}# after the hang\n`);
    await fireDebounce();
    expect(result.current).toEqual([EXPECTED_ROW]);
  });
});

// Audit 20260907 round 3 (#584): the run chain handled FULFILMENT only. The
// tail it stored was `chain.then(work)`, so anything thrown while DELIVERING an
// outcome — the toast surface, the state update — left `chainRef.current`
// rejected, and every later run then queued behind a rejected promise and was
// skipped. One transient failure disabled actionlint for the rest of the
// session, silently, plus an unhandled rejection per run.
describe("a failure while delivering an outcome does not kill the chain", () => {
  it("keeps linting after the toast surface throws", async () => {
    warningMock.mockImplementationOnce(() => {
      throw new Error("toast surface is gone");
    });
    lintReplies(FAILED);
    const { result } = renderHook(() => useActionlintDiagnostics("tab-1"));
    await fireDebounce();
    expect(lintCalls()).toHaveLength(1);

    // The next edit must still reach actionlint, and its rows must land.
    lintReplies(OK_ONE);
    editDocument("tab-1", `${YAML}# edit\n`);
    await fireDebounce();
    expect(lintCalls()).toHaveLength(2);
    expect(result.current).toEqual([EXPECTED_ROW]);
  });

  it("leaves no unhandled rejection behind", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      warningMock.mockImplementationOnce(() => {
        throw new Error("toast surface is gone");
      });
      lintReplies(FAILED);
      renderHook(() => useActionlintDiagnostics("tab-1"));
      await fireDebounce();
      await act(async () => {
        await Promise.resolve();
      });
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
