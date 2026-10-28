/**
 * Shared rig for the comments panel's focus tests: a journal fake answering
 * the list read from `rig.threads` and every other call through
 * `rig.answer`, one open tab on `/a.md`, the WebKit focus model, the panel
 * under StrictMode as the app mounts it, a list read that can be held back
 * or made to fail, and the helpers that find a thread and activate a
 * control. Each test file still declares its own `vi.mock` calls.
 */
import { StrictMode } from "react";
import { afterEach, beforeEach, onTestFinished, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEditorStore } from "@/stores/editorStore";
import { resolveKey } from "@/test/i18nResolve";
import { installWebKitFocusModel, mouseClick, nextFrame } from "@/test/webkitFocusModel";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { CommentThread } from "@/services/agentJournal/comments/commentReplies";
import { CommentsPanel } from "../CommentsPanel";
import { forgetCommentDrafts } from "../commentDrafts";
import { releaseCommentAction, takeCommentAction } from "../commentActionLock";

const TAB = "t-1";
const KEY = "path:/a.md";
export const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
export const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);

export const thread = (comment: string, over: Partial<CommentThread> = {}): CommentThread => ({
  comment,
  state: "open",
  commentGen: "2",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: `quote of ${comment}`,
  body: `body of ${comment}`,
  author: "",
  caller: "user",
  replies: [],
  anchor: { status: "resolved", tier: "context", start: 5, end: 10, byHint: true },
  ...over,
});

export type Args = Record<string, unknown>;
/** What the journal lists, and how it answers every other call. */
export const rig: { threads: CommentThread[]; answer: (command: string, args: Args) => Promise<unknown> } = {
  threads: [],
  answer: async () => undefined,
};

export const article = (comment = "c1") => screen.findByRole("article", { name: `quote of ${comment}` });
export const button = async (key: string, comment = "c1") => within(await article(comment)).findByRole("button", { name: en(key) });
/** The first control of `comment`'s thread. */
export const firstControl = async (comment: string) => within(await article(comment)).getAllByRole("button")[0];
export const addButton = () => screen.getByRole("button", { name: en("comments.add") });
export const dismissButton = () => screen.findByRole("button", { name: en("comments.dismiss") });
/** An answer that arrives after the next frame, so a control disabled meanwhile has lost focus. */
export const slow = async <T,>(value: T): Promise<T> => {
  await nextFrame();
  return value;
};
export const replyBox = () => screen.getByRole("textbox", { name: en("comments.replyLabel") });
export const panel = (pollMs: number | null = null) => (
  <StrictMode>
    <CommentsPanel tabId={TAB} docKey={KEY} pollMs={pollMs} />
  </StrictMode>
);

/** List reads waiting for `releaseList()`, or null while reads answer at once. */
let heldReads: Array<() => void> | null = null;
/** Whether list reads fail. */
let failing = false;
/** Make every list read from now on fail (`true`) or answer again (`false`). */
export function failList(on: boolean): void {
  failing = on;
}
const listAnswer = () => ({ doc: DOC, generation: "3", threads: rig.threads });
/** Hold every list read from now until `releaseList()`, so a state that waits for the re-read can be observed. */
export function holdList(): void {
  heldReads ??= [];
}
/** Answer the held list reads with the threads listed now, and answer later reads at once. */
export async function releaseList(): Promise<void> {
  const held = heldReads ?? [];
  heldReads = null;
  await act(async () => {
    for (const answer of held) answer();
  });
}
const readList = () => (failing ? Promise.reject(new Error("list read failed")) : heldReads === null ? Promise.resolve(listAnswer()) : new Promise((resolve) => heldReads?.push(() => resolve(listAnswer()))));

/** A button outside the panel (the editor, say), removed when the test ends. */
export function outside(): HTMLButtonElement {
  const el = document.createElement("button");
  document.body.appendChild(el);
  onTestFinished(() => el.remove());
  return el;
}

/** Another panel's action on the document takes the shared lock, disabling this panel's controls; returns its release. */
export function busyElsewhere(): () => void {
  act(() => {
    if (!takeCommentAction(KEY)) throw new Error("the lock was already held");
  });
  return () => act(() => releaseCommentAction(KEY));
}

/** A mouse click as WebKit delivers it: the control does not take focus, and focus leaves for the page. */
export const click = mouseClick;
/** Keyboard activation: focus the control, then Enter. */
export async function press(el: HTMLElement): Promise<void> {
  act(() => el.focus());
  await userEvent.keyboard("{Enter}");
}
export type How = "keyboard" | "mouse";
/** Activate `el` by keyboard or by mouse. */
export const activate = async (el: HTMLElement, how: How) => (how === "keyboard" ? press(el) : click(el));

const TEXT = "# T\n\nhello world\n";
/** A Source editor of the tab with "world" selected, so Comment on selection opens a draft. */
export function editorSelection(): void {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const at = TEXT.indexOf("world");
  const view = new EditorView({ state: EditorState.create({ doc: TEXT, selection: { anchor: at, head: at + 5 } }), parent });
  useEditorStore.getState().setActiveSourceView(view, TAB);
  onTestFinished(() => {
    useEditorStore.getState().setActiveSourceView(null);
    view.destroy();
    parent.remove();
  });
}

/** Reset the fake, drafts and stores, and install the WebKit focus model, for each test of the calling file. */
export function installCommentRig(): void {
  let uninstall: () => void = () => undefined;
  afterEach(() => uninstall());
  beforeEach(() => {
    uninstall = installWebKitFocusModel();
    vi.clearAllMocks();
    fake.reset();
    forgetCommentDrafts();
    // The lock outlives a panel by design, so an action a test left under way must not hold the next test's panel.
    releaseCommentAction(KEY);
    rig.threads = [thread("c1")];
    rig.answer = async () => undefined;
    heldReads = null;
    failing = false;
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => (command === "comment_user_list" ? readList() : rig.answer(command, args as Args)));
    useDocumentStore.setState({ documents: {} });
    useTabStore.setState({
      tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
      activeTabId: { main: TAB },
      untitledCounter: 0,
    });
    useDocumentStore.getState().initDocument(TAB, TEXT, "/a.md");
  });
}
