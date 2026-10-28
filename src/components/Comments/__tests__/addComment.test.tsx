// WI-AL3.2 — adding a comment on the selection, through the real selection reader, create coordinator and client over the journal wire (only the IPC is answered): the selection is read once, when "Comment on selection" is clicked, and the comment is created on that selection whatever the editor does while the body is typed; a caret says it anchors to its paragraph; no readable selection, or an editor that cannot hand over its pending edits, is told and opens nothing; an empty body cannot be sent; a refusal or an abort (the tab closed) is told and keeps the draft; success is told, closes the draft and re-reads the list; the draft (selection and body) outlives the panel unmounting — the popover closing — and is forgotten on cancel, and one tab's draft is never offered on another; opening the draft focuses its body, and cancel or success returns focus to the button, a refusal or an abort to Submit once it is enabled again; a WYSIWYG selection that cannot be mapped exactly (stored widened to whole blocks) says so in words true of one block or several, and one mapped exactly does not
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { resolveKey } from "@/test/i18nResolve";
import { installWebKitFocusModel, mouseClick as click, nextFrame } from "@/test/webkitFocusModel";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { markContentApplied } from "@/services/editor/contentApplied";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { AddComment } from "../AddComment";
import { forgetCommentDrafts } from "../commentDrafts";
import { useCommentFocus } from "../useCommentFocus";

const TAB = "t-1";
const TEXT = "# T\n\nhello world\n";
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);
const created = {
  doc: "0190d3c4-0000-7000-8000-0000000000d1",
  comment: "c7",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  textHash: `sha256-${"a".repeat(64)}`,
  generation: "1",
  commentGen: "0",
};

type Args = Record<string, unknown>;

/** The add box inside a panel section that owns its focus, as `CommentsPanel` hosts it. */
function HostedAdd(props: { tabId: string; onCreated: () => void }) {
  const { intents, sectionRef, onFocus, onBlur } = useCommentFocus(null);
  return (
    <section ref={sectionRef} data-list="none" onFocus={onFocus} onBlur={onBlur}>
      <AddComment {...props} focus={intents} />
    </section>
  );
}
let view: CMView | null = null;
let tiptap: Editor | null = null;
/** The create command's answer. */
let createAnswer: () => Promise<unknown> = async () => created;

const sentCreates = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === "comment_user_create")
    .map(([, a]) => JSON.parse(String((a as Args).payload)) as Args);

/** A Source editor of the tab, focused, holding TEXT with `[from, to]` selected. */
function editor(from: number, to: number): CMView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: TEXT, selection: { anchor: from, head: to } }), parent });
  useEditorStore.getState().setActiveSourceView(view, TAB);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  forgetCommentDrafts();
  resetJournalBases();
  createAnswer = async () => created;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) =>
    command === "comment_user_create" ? answerPrepare(args, () => createAnswer()) : undefined,
  );
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, TEXT, "/a.md");
});

afterEach(() => {
  useEditorStore.getState().setActiveSourceView(null);
  useEditorStore.getState().setActiveWysiwygEditor(null);
  tiptap?.destroy();
  tiptap = null;
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

async function openDraft(onCreated = vi.fn()) {
  const user = userEvent.setup();
  const rendered = render(<HostedAdd tabId={TAB} onCreated={onCreated} />);
  click(addButton());
  return { user, onCreated, rendered };
}

const addButton = () => screen.getByRole("button", { name: en("comments.add") });

const WORLD = TEXT.indexOf("world");
/** The comment body box (the Source editor is a textbox too). */
const body = () => screen.getByRole("textbox", { name: en("comments.bodyLabel") });

describe("AddComment", () => {
  it("creates the comment on the selection read at the click", async () => {
    const v = editor(WORLD, WORLD + 5);
    const { user, onCreated } = await openDraft();

    expect(screen.getByText("world")).toBeInTheDocument();
    // The editor's selection moves while the body is typed: the anchor does not.
    v.dispatch({ selection: { anchor: 0, head: 3 } });
    await user.type(body(), "why?");
    click(screen.getByRole("button", { name: en("comments.submit") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en("comments.created")));
    expect(sentCreates()).toEqual([
      expect.objectContaining({ text: TEXT, body: "why?", selection: { start: WORLD, end: WORLD + 5, precision: "exact" } }),
    ]);
    expect(onCreated).toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull();
  });

  it("says a caret anchors to its paragraph, and sends the caret", async () => {
    editor(WORLD, WORLD);
    const { user } = await openDraft();
    expect(screen.getByText(en("comments.onCaret"))).toBeInTheDocument();
    await user.type(body(), "x");
    click(screen.getByRole("button", { name: en("comments.submit") }));
    await waitFor(() => expect(sentCreates()).toEqual([expect.objectContaining({ selection: { start: WORLD, end: WORLD, precision: "exact" } })]));
  });

  it("tells when there is no selection to read, and opens nothing", async () => {
    await openDraft();
    expect(toast.info).toHaveBeenCalledWith(en("comments.noSelection"));
    expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull();
  });

  it("tells when the editor cannot hand over its pending edits, and opens nothing", async () => {
    editor(WORLD, WORLD + 5);
    registerWysiwygFlusher(TAB, () => {
      throw new Error("serializer crashed");
    });
    onTestFinished(() => registerWysiwygFlusher(TAB, null));
    await openDraft();
    expect(toast.error).toHaveBeenCalledWith(en("comments.failed"));
    expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull();
  });

  it("cannot send an empty body", async () => {
    editor(WORLD, WORLD + 5);
    const { user } = await openDraft();
    await user.type(body(), "   ");
    expect(screen.getByRole("button", { name: en("comments.submit") })).toBeDisabled();
  });

  it.each([
    [
      "a refusal",
      () => {
        createAnswer = async () => {
          throw new JournalRefusal("COMMENT_ANCHOR_TOO_LONG", "x");
        };
      },
      "comments.refusedAnchorTooLong",
      1,
    ],
    [
      "a tab closed before the comment is sent",
      () => {
        useDocumentStore.setState({ documents: {} });
      },
      "comments.abortedClosed",
      0,
    ],
  ] as const)("tells %s and keeps the draft", async (_name, arrange, key, sends) => {
    editor(WORLD, WORLD + 5);
    arrange();
    const { user } = await openDraft();
    await user.type(body(), "x");
    click(screen.getByRole("button", { name: en("comments.submit") }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en(key)));
    expect(sentCreates()).toHaveLength(sends);
    expect(body()).toHaveValue("x");
  });

  it.each([
    [
      "a refusal that arrives after Submit lost focus",
      () => {
        createAnswer = async () => {
          await nextFrame();
          expect(document.activeElement).toBe(document.body);
          throw new JournalRefusal("COMMENT_ANCHOR_TOO_LONG", "x");
        };
      },
    ],
    ["an abort", () => useDocumentStore.setState({ documents: {} })],
  ] as const)("returns focus to Submit after %s, once it is enabled again", async (_name, arrange) => {
    onTestFinished(installWebKitFocusModel());
    editor(WORLD, WORLD + 5);
    arrange();
    const { user } = await openDraft();
    await user.type(body(), "x");
    const submit = screen.getByRole("button", { name: en("comments.submit") });
    act(() => submit.focus());
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: en("comments.submit") })));
    expect(screen.getByRole("button", { name: en("comments.submit") })).toBeEnabled();
  });

  it("keeps the draft, selection and body, when the panel unmounts, and forgets it on cancel", async () => {
    const v = editor(WORLD, WORLD + 5);
    const { user, rendered } = await openDraft();
    await user.type(body(), "keep me");
    rendered.unmount();
    v.dispatch({ selection: { anchor: 0, head: 3 } });

    const again = render(<HostedAdd tabId={TAB} onCreated={vi.fn()} />);
    expect(body()).toHaveValue("keep me");
    expect(screen.getByText("world")).toBeInTheDocument();
    click(screen.getByRole("button", { name: en("comments.cancel") }));
    again.unmount();

    render(<HostedAdd tabId={TAB} onCreated={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull();
  });

  it("does not offer one tab's draft on another tab", async () => {
    editor(WORLD, WORLD + 5);
    const { user, rendered } = await openDraft();
    await user.type(body(), "for t-1");
    rendered.rerender(<HostedAdd tabId="t-2" onCreated={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull();
    rendered.rerender(<HostedAdd tabId={TAB} onCreated={vi.fn()} />);
    expect(body()).toHaveValue("for t-1");
  });

  it("focuses the body when the draft opens, and returns focus to its button on cancel and after adding", async () => {
    onTestFinished(installWebKitFocusModel());
    editor(WORLD, WORLD + 5);
    const user = userEvent.setup();
    render(<HostedAdd tabId={TAB} onCreated={vi.fn()} />);
    click(addButton());
    expect(document.activeElement).toBe(body());

    click(screen.getByRole("button", { name: en("comments.cancel") }));
    expect(document.activeElement).toBe(addButton());

    click(addButton());
    await user.type(body(), "x");
    click(screen.getByRole("button", { name: en("comments.submit") }));
    await waitFor(() => expect(document.activeElement).toBe(addButton()));
  });

  describe("a WYSIWYG selection", () => {
    /** A mounted WYSIWYG editor of the tab holding `html`, with `select` applied. */
    function wysiwyg(html: string, select: (editor: Editor) => void): void {
      tiptap = new Editor({ extensions: [StarterKit], content: html });
      markContentApplied(tiptap);
      useEditorStore.getState().setActiveWysiwygEditor(tiptap, TAB);
      select(tiptap);
    }

    it("that cannot be mapped exactly says the comment will quote its whole block", async () => {
      wysiwyg("<p>a</p><hr><p>b</p>", (e) => e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, 3))));
      await openDraft();
      expect(screen.getByText(en("comments.widened"))).toBeInTheDocument();
    });

    it("that spans several blocks is told in words true of several blocks", async () => {
      wysiwyg("<p>a</p><hr><p>b</p>", (e) => e.commands.selectAll());
      await openDraft();
      const note = screen.getByText(en("comments.widened"));
      expect(note.textContent).toMatch(/every block it touches/);
      expect(note.textContent).not.toMatch(/the whole block it is in/);
    });

    it("mapped exactly quotes the selection as it is, with no note", async () => {
      wysiwyg("<p>hello world</p>", (e) => e.commands.setTextSelection({ from: 7, to: 12 }));
      await openDraft();
      expect(screen.getByText("world")).toBeInTheDocument();
      expect(screen.queryByText(en("comments.widened"))).toBeNull();
    });
  });
});
