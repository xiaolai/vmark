// WI-AL3.2 — a comment being created is one action on its document, whatever the popover does: the panel reopened while it runs mounts busy and cannot send it again; while it runs the body cannot be edited nor the draft cancelled, so nothing typed after Submit is lost and a refusal keeps the draft; when it lands, the draft is forgotten in the panel that is open now, not only in the one that sent it. Edge cases: the popover closed and reopened mid-create, a create that is refused
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorState as CMState } from "@codemirror/state";
import { EditorView as CMView } from "@codemirror/view";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { resolveKey } from "@/test/i18nResolve";
import { mouseClick as click } from "@/test/webkitFocusModel";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { resetJournalBases } from "@/services/agentJournal/documentIdentity";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useTabStore } from "@/stores/tabStore";
import { AddComment } from "../AddComment";
import { forgetCommentDrafts } from "../commentDrafts";
import { isCommentActionLocked } from "../commentActionLock";
import { useCommentFocus } from "../useCommentFocus";

const TAB = "t-1";
const TEXT = "# T\n\nhello world\n";
const WORLD = TEXT.indexOf("world");
const en = (key: string, values?: Record<string, unknown>) => resolveKey(key, ["statusbar"], values);
const created = {
  doc: "0190d3c4-0000-7000-8000-0000000000d1",
  comment: "c7",
  revision: "0190d3c4-0000-7000-8000-000000000011",
  textHash: `sha256-${"a".repeat(64)}`,
  generation: "1",
  commentGen: "0",
};

function HostedAdd() {
  const { intents, sectionRef, onFocus, onBlur } = useCommentFocus(null);
  return (
    <section ref={sectionRef} data-list="none" onFocus={onFocus} onBlur={onBlur}>
      <AddComment tabId={TAB} onCreated={vi.fn()} focus={intents} />
    </section>
  );
}

let view: CMView | null = null;
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
/** Every create still in flight, the latest last. */
let pending: Pending[] = [];
const answer = () => pending.at(-1)!;
const creates = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "comment_user_create").length;
const body = () => screen.getByRole("textbox", { name: en("comments.bodyLabel") });
const submit = () => screen.getByRole("button", { name: en("comments.submit") });
const cancel = () => screen.getByRole("button", { name: en("comments.cancel") });

beforeEach(() => {
  vi.clearAllMocks();
  fake.reset();
  forgetCommentDrafts();
  resetJournalBases();
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) =>
    command === "comment_user_create"
      ? answerPrepare(args, () => new Promise((resolve, reject) => pending.push({ resolve, reject })))
      : undefined,
  );
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/a.md", title: "a", isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, TEXT, "/a.md");
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new CMView({ state: CMState.create({ doc: TEXT, selection: { anchor: WORLD, head: WORLD + 5 } }), parent });
  useEditorStore.getState().setActiveSourceView(view, TAB);
});

afterEach(async () => {
  // A create left running would hold its draft's lock into the next test.
  for (const p of pending) p.reject(new JournalRefusal("COMMENT_ANCHOR_TOO_LONG", "test over"));
  pending = [];
  await waitFor(() => expect(isCommentActionLocked(`add\n${TAB}`)).toBe(false));
  useEditorStore.getState().setActiveSourceView(null);
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = null;
});

/** Open the draft, type `text`, and Submit; the create stays in flight. */
async function submitted(text = "why?") {
  const user = userEvent.setup();
  const rendered = render(<HostedAdd />);
  click(screen.getByRole("button", { name: en("comments.add") }));
  await user.type(body(), text);
  click(submit());
  await waitFor(() => expect(creates()).toBe(1));
  return { user, rendered };
}

describe("AddComment while its create runs", () => {
  it("mounts busy when reopened, and does not send the comment again", async () => {
    const { rendered } = await submitted();
    rendered.unmount();
    render(<HostedAdd />);
    expect(submit()).toBeDisabled();
    click(submit());
    expect(creates()).toBe(1);
  });

  it("neither edits the body nor cancels the draft", async () => {
    const { user } = await submitted();
    expect(body()).toHaveAttribute("readonly");
    expect(cancel()).toBeDisabled();
    await user.type(body(), " more");
    expect(body()).toHaveValue("why?");
  });

  it("forgets the draft in the reopened panel once the create lands", async () => {
    const { rendered } = await submitted();
    rendered.unmount();
    render(<HostedAdd />);
    expect(body()).toHaveValue("why?");
    answer().resolve(created);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: en("comments.bodyLabel") })).toBeNull());
    expect(screen.getByRole("button", { name: en("comments.add") })).toBeEnabled();
  });

  it("keeps the draft, editable again, after a refusal", async () => {
    await submitted();
    answer().reject(new JournalRefusal("COMMENT_ANCHOR_TOO_LONG", "x"));
    await waitFor(() => expect(cancel()).toBeEnabled());
    expect(body()).toHaveValue("why?");
    expect(body()).not.toHaveAttribute("readonly");
  });
});
