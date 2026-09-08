// WI-FL5.3 — genieInvocation/streamRunner: one genie invocation against the
// Rust backend, observed through the real stores and a real editor (ledger
// F7, genie-invocation). The boundary — Tauri `invoke`/`listen` and sonner —
// is mocked; nothing inside the app is.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  useAiInvocationStore,
  useAiProviderStore,
  useAiSuggestionStore,
} from "@/stores/aiStore";
import { useGeniePickerStore } from "@/stores/geniePickerStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { setCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { runGenieStream } from "./streamRunner";
import type { ExtractionResult } from "./extraction";

type ChunkHandler = (event: { payload: Record<string, unknown> }) => void;

const bridge = vi.hoisted(() => ({
  handler: null as ChunkHandler | null,
  unlisten: vi.fn(),
  listenError: null as Error | null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, handler: ChunkHandler) => {
    if (bridge.listenError) return Promise.reject(bridge.listenError);
    bridge.handler = handler;
    return Promise.resolve(bridge.unlisten);
  }),
}));

// sonner is the external boundary; the IME-safe wrapper runs real.
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockInvoke = vi.mocked(invoke);

const ORIGIN_TAB = "tab-origin";
const OTHER_TAB = "tab-other";

/** `<p>hello world</p>` → "hello" sits at positions 1–6. */
const REPLACE_HELLO: ExtractionResult = { text: "hello", from: 1, to: 6 };

let editors: Editor[] = [];

function mountEditor(tabId: string = ORIGIN_TAB): Editor {
  const editor = new Editor({ extensions: [StarterKit], content: "<p>hello world</p>" });
  editors.push(editor);
  useEditorStore.getState().setTiptapEditor(editor);
  // The apply path reads the TAB-BOUND active editor (audit #963), not the
  // generic Tiptap slot — `tiptap.editor` is whichever editor registered last.
  useEditorStore.getState().setActiveWysiwygEditor(editor, tabId);
  return editor;
}

function useRestProvider(apiKey = "sk-test") {
  useAiProviderStore.setState({
    activeProvider: "openai",
    cliProviders: [],
    restProviders: [
      { type: "openai", name: "OpenAI", endpoint: "https://api.openai.com/v1", apiKey, model: "gpt-4" },
    ],
  });
}

function setAutoApprove(enabled: boolean) {
  const advanced = useSettingsStore.getState().advanced;
  useSettingsStore.getState().updateAdvancedSetting("mcpServer", {
    ...advanced.mcpServer,
    autoApproveEdits: enabled,
  });
}

function listenerRef(): { current: UnlistenFn | null } {
  return { current: null };
}

async function start(overrides: Partial<Parameters<typeof runGenieStream>[0]> = {}) {
  const ref = listenerRef();
  await runGenieStream({
    filledPrompt: "Fix this: hello",
    extraction: REPLACE_HELLO,
    processingLabel: "Fix",
    action: "replace",
    listenerRef: ref,
    ...overrides,
  });
  return ref;
}

function requestId(): string {
  const id = useAiInvocationStore.getState().requestId;
  if (!id) throw new Error("no invocation running");
  return id;
}

function emit(payload: Record<string, unknown>) {
  if (!bridge.handler) throw new Error("no ai:response listener registered");
  bridge.handler({ payload: { requestId: requestId(), chunk: "", done: false, ...payload } });
}

function suggestions() {
  return [...useAiSuggestionStore.getState().suggestions.values()];
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.handler = null;
  bridge.listenError = null;
  mockInvoke.mockReset().mockResolvedValue(undefined);
  useAiInvocationStore.getState().cancel();
  // No document state leaks between cases (the read-only case below writes one).
  useDocumentStore.setState({ documents: {} });
  useGeniePickerStore.getState().closePicker();
  useAiSuggestionStore.setState({ suggestions: new Map(), focusedSuggestionId: null });
  useSettingsStore.getState().resetSettings();
  useEditorStore.getState().clearTiptap();
  setCurrentWindowLabel("main");
  useTabStore.setState({ activeTabId: { main: ORIGIN_TAB } });
  useRestProvider();
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

describe("runGenieStream — provider validation", () => {
  it("a CLI provider that is not installed is refused with a toast, before any IPC", async () => {
    useAiProviderStore.setState({
      activeProvider: "claude",
      restProviders: [],
      cliProviders: [{ type: "claude", name: "Claude Code", command: "claude", available: false }],
    });

    await start();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain("Claude Code");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  it("a REST provider without an API key is refused with a toast naming it", async () => {
    useRestProvider("");

    await start();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain("OpenAI");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("a key-optional REST provider (ollama-api) runs without a key", async () => {
    useAiProviderStore.setState({
      activeProvider: "ollama-api",
      cliProviders: [],
      restProviders: [{ type: "ollama-api", name: "Ollama", endpoint: "http://localhost:11434", apiKey: "", model: "llama3" }],
    });

    await start();

    expect(toast.error).not.toHaveBeenCalled();
    // The configured key travels verbatim — an unset key is the empty string, not null.
    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.objectContaining({ provider: "ollama-api", apiKey: "" }));
  });

  it("does nothing when no provider is active", async () => {
    useAiProviderStore.setState({ activeProvider: null });
    await start();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("runGenieStream — the invocation lock and the request", () => {
  it("acquires the singleton lock, shows processing, listens on ai:response and invokes run_ai_prompt with the same requestId", async () => {
    const ref = await start({ model: "gpt-4o-mini" });

    const state = useAiInvocationStore.getState();
    expect(state.isRunning).toBe(true);
    expect(useGeniePickerStore.getState().mode).toBe("processing");
    expect(useGeniePickerStore.getState().submittedPrompt).toBe("Fix");
    expect(ref.current).toBe(bridge.unlisten);
    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", {
      requestId: state.requestId,
      provider: "openai",
      prompt: "Fix this: hello",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      endpoint: "https://api.openai.com/v1",
      cliPath: null,
    });
  });

  it("falls back to the provider's configured model when the genie declares none", async () => {
    await start({ model: undefined });
    expect(mockInvoke).toHaveBeenCalledWith("run_ai_prompt", expect.objectContaining({ model: "gpt-4" }));
  });

  it("a second invocation while one is running is refused — no listener, no IPC", async () => {
    await start();
    mockInvoke.mockClear();
    const first = requestId();

    await start();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(requestId()).toBe(first);
  });

  it("a rejected listen() fails the invocation loudly instead of leaving it stuck in processing", async () => {
    bridge.listenError = new Error("event bridge down");

    const ref = await start();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toBe("event bridge down");
    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(useGeniePickerStore.getState().pickerError).toBe("event bridge down");
    expect(ref.current).toBeNull();
  });

  it("a rejected invoke surfaces the error and releases the stream listener", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("provider exploded"));

    const ref = await start();

    expect(useAiInvocationStore.getState().error).toBe("provider exploded");
    expect(useGeniePickerStore.getState().pickerError).toBe("provider exploded");
    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });
});

describe("runGenieStream — streaming", () => {
  it("accumulates only this request's chunks into the picker", async () => {
    await start();

    emit({ chunk: "Hel" });
    bridge.handler?.({ payload: { requestId: "someone-else", chunk: "NOPE", done: false } });
    emit({ chunk: "lo" });

    expect(useGeniePickerStore.getState().responseText).toBe("Hello");
  });

  it("a frame without a text field appends nothing — never the literal 'undefined'", async () => {
    await start();
    emit({ chunk: "Hi" });
    emit({ done: false, chunk: undefined });
    expect(useGeniePickerStore.getState().responseText).toBe("Hi");
  });

  it("an error frame fails the invocation and releases the listener", async () => {
    const ref = await start();

    emit({ error: "rate limited" });

    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toBe("rate limited");
    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it("a done frame with only whitespace accumulated is an 'empty response' error", async () => {
    await start();

    emit({ chunk: "   \n" });
    emit({ done: true });

    expect(useAiInvocationStore.getState().error).toBeTruthy();
    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(suggestions()).toHaveLength(0);
  });
});

describe("runGenieStream — terminal result without auto-approve", () => {
  it("shows the trimmed result as a preview, finishes the invocation, and queues a replace suggestion for the originating tab", async () => {
    mountEditor();
    const ref = await start();

    emit({ chunk: "  Howdy " });
    emit({ done: true });

    const picker = useGeniePickerStore.getState();
    expect(picker.mode).toBe("preview");
    expect(picker.responseText).toBe("Howdy");
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().showSuccess).toBe(true);

    expect(suggestions()).toEqual([
      expect.objectContaining({
        tabId: ORIGIN_TAB,
        type: "replace",
        from: 1,
        to: 6,
        wholeDoc: false,
        newContent: "Howdy",
        originalContent: "hello",
      }),
    ]);
    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it("an insert genie suggests an insertion AFTER the source range with no original text", async () => {
    await start({ action: "insert" });

    emit({ chunk: "appendix", done: true });

    expect(suggestions()).toEqual([
      expect.objectContaining({ type: "insert", from: 6, to: 6, wholeDoc: false, originalContent: "" }),
    ]);
  });

  it("a whole-document extraction is flagged on the suggestion", async () => {
    await start({ extraction: { text: "hello world", from: 0, to: 13, wholeDoc: true } });
    emit({ chunk: "rewritten", done: true });
    expect(suggestions()[0]?.wholeDoc).toBe(true);
  });
});

describe("runGenieStream — auto-approve", () => {
  it("applies the result straight into the live editor, closes the picker and finishes", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();

    emit({ chunk: "Howdy", done: true });

    expect(editor.getText()).toBe("Howdy world");
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(suggestions()).toHaveLength(0);
  });

  it("stale-target guard: a tab switch mid-stream DOWNGRADES the apply to a suggestion for the originating tab", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();
    emit({ chunk: "Howdy" });

    // The user moves to another tab while the stream is still arriving.
    useTabStore.setState({ activeTabId: { main: OTHER_TAB } });
    emit({ done: true });

    expect(editor.getText()).toBe("hello world"); // the now-active editor is untouched
    expect(suggestions()).toEqual([
      expect.objectContaining({ tabId: ORIGIN_TAB, type: "replace", from: 1, to: 6, newContent: "Howdy" }),
    ]);
    expect(useGeniePickerStore.getState().isOpen).toBe(false);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toBeNull();
  });

  it("the guard keys on the tab, not the window: switching to another window's tab is not a downgrade", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();

    useTabStore.setState({ activeTabId: { main: ORIGIN_TAB, other: OTHER_TAB } });
    emit({ chunk: "Howdy", done: true });

    expect(editor.getText()).toBe("Howdy world");
  });

  it("an editor that vanished before the done frame is an error, not a silent drop", async () => {
    mountEditor();
    setAutoApprove(true);
    await start();

    useEditorStore.getState().clearTiptap();
    useEditorStore.getState().clearActiveEditors();
    emit({ chunk: "Howdy", done: true });

    expect(useAiInvocationStore.getState().error).toBeTruthy();
    expect(useGeniePickerStore.getState().mode).toBe("error");
    expect(suggestions()).toHaveLength(0);
  });

  // audit #963 — `tiptap.editor` is whichever editor registered LAST. With a
  // split pane, or a Source pane holding focus, that is not the editor showing
  // the originating document, and a programmatic dispatch into it edits the
  // WRONG file. The active slice carries the tab it belongs to.
  it("refuses to write through an editor registered for a different tab", async () => {
    const editor = mountEditor(OTHER_TAB);
    setAutoApprove(true);
    await start();

    emit({ chunk: "Howdy", done: true });

    // The wrong document is not touched, and the refusal is REPORTED — the
    // same contract as "the editor vanished", which this is a case of: no
    // editor is registered for the originating tab.
    expect(editor.getText()).toBe("hello world");
    expect(useAiInvocationStore.getState().error).toBeTruthy();
    expect(suggestions()).toHaveLength(0);
  });

  // audit #964 — ProseMirror's `editable` gates INPUT handlers, not
  // transactions, so an auto-apply walked straight past a read-only document.
  // Read-only is how a second window's copy is held; editing it is the one
  // outcome that must never happen silently.
  it("refuses to write into a read-only document, keeping the result as a suggestion", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    useDocumentStore.getState().initDocument(ORIGIN_TAB, "hello world");
    useDocumentStore.getState().setReadOnly(ORIGIN_TAB, true);
    await start();

    emit({ chunk: "Howdy", done: true });

    expect(editor.getText()).toBe("hello world");
    expect(suggestions()).toEqual([
      expect.objectContaining({ tabId: ORIGIN_TAB, newContent: "Howdy" }),
    ]);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
  });

  // audit #965 — the captured from/to describe the document as it was when the
  // run started. A stream can last minutes; typing in the SAME tab shifts every
  // position after the edit, and writing the old range then overwrites text the
  // user just entered.
  it("refuses to write a captured range into a document that changed mid-stream", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();
    emit({ chunk: "How" });

    // The user types while the stream is still arriving.
    editor.commands.insertContentAt(1, "XYZ ");
    const afterTyping = editor.getText();
    emit({ done: true });

    expect(editor.getText()).toBe(afterTyping);
    expect(suggestions()).toEqual([
      expect.objectContaining({ tabId: ORIGIN_TAB, newContent: "How" }),
    ]);
  });
});

// audit #970 — the chunk handler runs in a Tauri EVENT callback, which
// `runGenieStream`'s outer try/catch cannot reach. A throw from the apply path
// (markdown parsing, transaction construction, `view.dispatch`, a suggestion
// store write) therefore skipped `releaseListener` and left the singleton lock
// held: the picker sat in "processing" and no further genie could start.
describe("runGenieStream — a throwing terminal frame (audit #970)", () => {
  it("releases the listener and the lock instead of sticking in processing", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    const ref = await start();
    // The dispatch is the realistic thrower: a slice built from a malformed
    // model, or a plugin that rejects the transaction.
    vi.spyOn(editor.view, "dispatch").mockImplementation(() => {
      throw new Error("dispatch exploded");
    });

    expect(() => emit({ chunk: "Howdy", done: true })).not.toThrow();

    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toMatch(/dispatch exploded/);
    expect(bridge.unlisten).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });
});

describe("runGenieStream — request scoping (audit #967/#974)", () => {
  it("ignores a chunk for a request the store no longer considers active", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();

    // The user cancels: the store drops the request id, but a frame already in
    // the queue still carries it — a payload-id match alone would let it write
    // state that now belongs to whatever runs next.
    const staleId = requestId();
    useAiInvocationStore.getState().cancel();
    bridge.handler?.({ payload: { requestId: staleId, chunk: "Howdy", done: true } });

    expect(editor.getText()).toBe("hello world");
    expect(suggestions()).toHaveLength(0);
    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().error).toBeNull();
  });
});

// Audit #972 — `"unknown"` was a sentinel standing in for the originating tab.
// Nothing downstream treats it as absent: it becomes the tabId a suggestion is
// filed against, where no UI can reach it.
describe("runGenieStream — no originating tab", () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: {} });
  });

  it("refuses before taking the invocation lock, and says why", async () => {
    mountEditor();

    const ref = await start();

    expect(useAiInvocationStore.getState().isRunning).toBe(false);
    expect(useAiInvocationStore.getState().requestId).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(ref.current).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  it("files no suggestion against a phantom tab", async () => {
    mountEditor();
    await start();
    expect(suggestions()).toHaveLength(0);
  });

  it("leaves the lock free for the next run", async () => {
    mountEditor();
    await start();

    useTabStore.setState({ activeTabId: { main: ORIGIN_TAB } });
    await start();

    expect(useAiInvocationStore.getState().isRunning).toBe(true);
  });
});

// Audit #975 — `failInvocation` scopes its STORE write to the request, but its
// picker error is unconditional. Cancelling is what makes `run_ai_prompt`
// reject, so the cancel path painted its own rejection into the picker as a
// failure — or onto whatever run came next.
describe("runGenieStream — a rejection that no longer owns the invocation", () => {
  it("does not report a cancelled run's rejection as an error", async () => {
    mountEditor();
    let rejectInvoke!: (reason: Error) => void;
    mockInvoke.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectInvoke = reject; }),
    );

    const pending = start();
    await vi.waitFor(() => expect(bridge.handler).not.toBeNull());
    // The user cancels; the backend then rejects the request it just killed.
    useAiInvocationStore.getState().cancel();
    rejectInvoke(new Error("Cancelled"));
    await pending;

    expect(useGeniePickerStore.getState().pickerError).toBeNull();
    expect(useAiInvocationStore.getState().error).toBeNull();
  });

  it("still reports a rejection that DOES own the invocation", async () => {
    mountEditor();
    mockInvoke.mockRejectedValue(new Error("provider exploded"));

    await start();

    expect(useGeniePickerStore.getState().pickerError).toContain("provider exploded");
    expect(useAiInvocationStore.getState().error).toContain("provider exploded");
  });
});

// Audit #969 asked for a request-local terminal flag. There already is a
// terminal guard, one level out: every terminal path clears the store's
// `requestId` (finish / setError), and the chunk handler drops any frame whose
// id is no longer the ACTIVE one (#967). These pin that property from the
// outside, so removing either half is loud rather than silent.
describe("runGenieStream — a re-delivered terminal frame", () => {
  /** The exact frame the backend sent, replayable after the run has ended. */
  function terminalFrame(id: string) {
    return { payload: { requestId: id, chunk: "fixed", done: true } };
  }

  it("adds the suggestion once", async () => {
    mountEditor();
    setAutoApprove(false);
    await start();
    const id = requestId();
    const frame = terminalFrame(id);

    bridge.handler!(frame);
    bridge.handler!(frame);

    expect(suggestions()).toHaveLength(1);
  });

  it("applies the edit once", async () => {
    const editor = mountEditor();
    setAutoApprove(true);
    await start();
    const id = requestId();
    const frame = terminalFrame(id);

    bridge.handler!(frame);
    const afterFirst = editor.getHTML();
    bridge.handler!(frame);

    expect(editor.getHTML()).toBe(afterFirst);
    expect(suggestions()).toHaveLength(0);
  });
});
