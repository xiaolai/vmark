// WI-AL3.2 — focus when a thread leaves the comments panel, by keyboard and by mouse as WebKit moves focus: after this window's delete focus goes to the thread now in its place, else the one before, else the add box's first control (the draft's body when a draft is open), whether the reply or a re-read dropping the thread came first, and of two quick deletes the second's place decides; the thread being replied to is replaced by the Deleted comment line, whose Dismiss takes focus and hands it to the first thread, else to Comment on selection, and when a successful read lists that thread again Dismiss hands focus to its restored reply box, while a failed read that takes it away leaves focus waiting until a read shows it again; a thread deleted elsewhere while focus was in it hands focus on the same way, also mid-composition in the reply box or while the window was in the background, and while this panel's own action runs focus waits for the controls to be enabled rather than skipping to the add box; a pressed action whose button another window's change removed hands focus to the action now in its place; a change that leaves the focused control in place, or happens while focus is elsewhere (another control, the editor, the page after leaving), takes nothing; a failed list read never sends focus to the add box, and focus returns once a read succeeds
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { ask } from "@tauri-apps/plugin-dialog";
import { nextFrame } from "@/test/webkitFocusModel";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import {
  DOC,
  activate,
  addButton,
  article,
  button,
  click,
  dismissButton,
  editorSelection,
  en,
  failList,
  firstControl,
  holdList,
  outside,
  panel,
  press,
  releaseList,
  replyBox,
  rig,
  thread,
  installCommentRig,
  type How,
} from "./commentFocusRig";

installCommentRig();

const HOW: How[] = ["keyboard", "mouse"];
const resolved = (...comments: string[]) => comments.map((c) => thread(c, { state: "resolved" }));
const gone = (comment: string) => waitFor(() => expect(screen.queryByRole("article", { name: `quote of ${comment}` })).toBeNull());
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await act(() => nextFrame());
};
/** Delete answers after a frame; the journal then lists `rest`. */
const deleteRecorded = (comment: string, rest: string[]) => {
  rig.answer = async (command) => {
    if (command !== "comment_user_delete") return undefined;
    rig.threads = resolved(...rest);
    await nextFrame();
    return { doc: DOC, comment, generation: "5" };
  };
  vi.mocked(ask).mockResolvedValue(true);
};

describe("focus after this window's delete", () => {
  it.each(HOW)("moves to the next thread's first control (%s)", async (how) => {
    rig.threads = resolved("c1", "c2");
    deleteRecorded("c1", ["c2"]);
    render(panel());
    await activate(await button("comments.delete"), how);
    await gone("c1");
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c2")));
  });

  it.each(HOW)("moves to the previous thread's first control when the last one is deleted (%s)", async (how) => {
    rig.threads = resolved("c1", "c2", "c3", "c4");
    deleteRecorded("c4", ["c1", "c2", "c3"]);
    render(panel());
    await activate(await button("comments.delete", "c4"), how);
    await gone("c4");
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c3")));
  });

  it("moves to the add draft's body when the only thread is deleted with a draft open", async () => {
    editorSelection();
    rig.threads = resolved("c1");
    deleteRecorded("c1", []);
    render(panel());
    click(await screen.findByRole("button", { name: en("comments.add") }));
    const body = screen.getByRole("textbox", { name: en("comments.bodyLabel") });
    click(await button("comments.delete"));
    await gone("c1");
    await waitFor(() => expect(document.activeElement).toBe(body));
  });

  it.each(HOW)("of two quick deletes, the second's place decides (%s)", async (how) => {
    rig.threads = resolved("c1", "c2", "c3", "c4");
    vi.mocked(ask).mockResolvedValue(true);
    rig.answer = async (command, args) => {
      if (command !== "comment_user_delete") return undefined;
      const { comment } = JSON.parse(String(args.payload)) as { comment: string };
      rig.threads = rig.threads.filter((t) => t.comment !== comment);
      return { doc: DOC, comment, generation: "5" };
    };
    render(panel());
    const first = await button("comments.delete", "c1");
    holdList();
    await activate(first, how);
    await waitFor(() => expect(first).toBeEnabled());
    // The list still shows c1; c2 is deleted before the re-read drops it.
    const second = await button("comments.delete", "c2");
    await activate(second, how);
    await waitFor(() => expect(second).toBeEnabled());
    await releaseList();
    await gone("c2");
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c4")));
  });
});

describe("focus when a re-read drops the deleted thread before the delete's reply", () => {
  /** Delete `comment` of c1–c4; the journal lists `rest` at once, and the call returns only after the panel re-read it. */
  const deleteReadFirst = async (comment: string, rest: string[], how: How) => {
    rig.threads = resolved("c1", "c2", "c3", "c4");
    let finish: () => void = () => undefined;
    rig.answer = (command) =>
      command === "comment_user_delete"
        ? new Promise((resolve) => {
            rig.threads = resolved(...rest);
            finish = () => resolve({ doc: DOC, comment, generation: "5" });
          })
        : Promise.resolve(undefined);
    vi.mocked(ask).mockResolvedValue(true);
    render(panel(10));
    await activate(await button("comments.delete", comment), how);
    await gone(comment);
    expect(document.activeElement).toBe(document.body);
    await act(async () => finish());
  };

  it.each(HOW)("a middle thread: focus goes to the thread now in its place (%s)", async (how) => {
    await deleteReadFirst("c3", ["c1", "c2", "c4"], how);
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c4")));
  });

  it.each(HOW)("the last thread: focus goes to the thread before it (%s)", async (how) => {
    await deleteReadFirst("c4", ["c1", "c2", "c3"], how);
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c3")));
  });
});

describe("the Deleted comment line", () => {
  it("takes focus when the thread being replied to is deleted here, then hands it to Comment on selection when no thread is left", async () => {
    rig.threads = resolved("c1");
    deleteRecorded("c1", []);
    render(panel());
    click(await button("comments.reply"));
    click(await button("comments.delete"));
    await waitFor(async () => expect(document.activeElement).toBe(await dismissButton()));

    await press(await dismissButton());
    await waitFor(() => expect(document.activeElement).toBe(addButton()));
  });

  it("hands focus to the first thread's first control on Dismiss", async () => {
    rig.threads = [thread("c1"), thread("c2")];
    rig.answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      rig.threads = [thread("c2", { state: "resolved", commentGen: "3" })];
      return { doc: DOC, comment: "c2", state: "resolved", generation: "4", commentGen: "3" };
    };
    render(panel());
    click(await button("comments.reply"));
    click(await button("comments.resolve", "c2"));
    click(await dismissButton());
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c2")));
  });

  it("keeps focus on Dismiss when another thread is deleted elsewhere", async () => {
    rig.threads = [thread("c1"), thread("c2"), thread("c3")];
    render(panel(10));
    click(await button("comments.reply"));
    rig.threads = [thread("c2"), thread("c3")];
    const dismiss = await dismissButton();
    await waitFor(() => expect(document.activeElement).toBe(dismiss));
    rig.threads = [thread("c3")];
    await gone("c2");
    await frames();
    expect(document.activeElement).toBe(dismiss);
  });

  const onDismiss = async () => {
    rig.threads = [thread("c1"), thread("c2")];
    render(panel(10));
    click(await button("comments.reply"));
    rig.threads = [thread("c2")];
    const dismiss = await dismissButton();
    await waitFor(() => expect(document.activeElement).toBe(dismiss));
  };
  const lineGone = () => waitFor(() => expect(screen.queryByRole("button", { name: en("comments.dismiss") })).toBeNull());

  it("waits when a failed read takes the line away, and Dismiss has focus again once a read succeeds", async () => {
    await onDismiss();
    // A failed read shows no list, so no line names a thread as deleted.
    failList(true);
    await lineGone();
    await frames(3);
    expect(document.activeElement).toBe(document.body);
    failList(false);
    await waitFor(async () => expect(document.activeElement).toBe(await dismissButton()));
  });

  it("hands focus to the restored reply box when a successful read lists the thread again", async () => {
    await onDismiss();
    rig.threads = [thread("c1"), thread("c2")];
    await lineGone();
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));
  });
});

describe("focus when a thread leaves from elsewhere", () => {
  it("moves from the reply box to the Deleted comment line's Dismiss", async () => {
    rig.threads = [thread("c1"), thread("c2")];
    const user = userEvent.setup();
    render(panel(10));
    click(await button("comments.reply"));
    await user.type(replyBox(), "half");
    rig.threads = [thread("c2")];
    await waitFor(async () => expect(document.activeElement).toBe(await dismissButton()));
  });

  it("moves from the reply box to Dismiss while a composition is under way", async () => {
    rig.threads = [thread("c1"), thread("c2")];
    render(panel(10));
    click(await button("comments.reply"));
    fireEvent.compositionStart(replyBox());
    rig.threads = [thread("c2")];
    await waitFor(async () => expect(document.activeElement).toBe(await dismissButton()));
  });

  it("moves from a focused thread's button to the next thread's first control", async () => {
    rig.threads = [thread("c1"), thread("c2"), thread("c3")];
    render(panel(10));
    act(() => void button("comments.resolve", "c2").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve", "c2")));
    rig.threads = [thread("c1"), thread("c3")];
    await gone("c2");
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c3")));
  });

  it("moves on the same way when the thread is deleted while the window is in the background", async () => {
    rig.threads = [thread("c1"), thread("c2"), thread("c3")];
    render(panel(10));
    const resolve = await button("comments.resolve", "c2");
    act(() => resolve.focus());
    // The window losing focus blurs the focused control with no related target, and it stays the active element.
    fireEvent.focusOut(resolve, { relatedTarget: null });
    rig.threads = [thread("c1"), thread("c3")];
    await gone("c2");
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c3")));
  });

  it("moves to the add draft's body when the only thread leaves with a draft open", async () => {
    editorSelection();
    render(panel(10));
    click(await screen.findByRole("button", { name: en("comments.add") }));
    const body = screen.getByRole("textbox", { name: en("comments.bodyLabel") });
    act(() => void button("comments.resolve").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
    rig.threads = [];
    await gone("c1");
    await waitFor(() => expect(document.activeElement).toBe(body));
  });

  it("moves from a pressed action another window removed to the action now in its place", async () => {
    render(panel(10));
    act(() => void button("comments.resolve").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
    rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
    await screen.findByText(en("comments.stateResolved"));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")));
  });

  it("stays put when a change leaves the focused control in place", async () => {
    render(panel(10));
    const reply = await button("comments.reply");
    act(() => reply.focus());
    rig.threads = [thread("c1", { commentGen: "3", replies: [{ reply: "r1", body: "elsewhere", author: "", caller: "agent" }] })];
    await screen.findByText("elsewhere");
    await frames();
    expect(document.activeElement).toBe(reply);
  });

  it("takes nothing when focus left the panel before, even once it fell to the page", async () => {
    rig.threads = [thread("c1"), thread("c2")];
    render(panel(10));
    act(() => void firstControl("c1").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c1")));
    const editor = outside();
    act(() => editor.focus());
    act(() => editor.blur());
    rig.threads = [thread("c2")];
    await gone("c1");
    await frames();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("focus while this panel's own action runs", () => {
  it("goes to the clicked action's place, not to a thread that left meanwhile, once the action ends", async () => {
    rig.threads = [thread("c1"), thread("c2"), thread("c3")];
    let finish: () => void = () => undefined;
    rig.answer = (command) =>
      command === "comment_user_resolve"
        ? new Promise((resolve) => {
            finish = () => {
              rig.threads = [thread("c1", { state: "resolved", commentGen: "3" }), thread("c3")];
              resolve({ doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" });
            };
          })
        : Promise.resolve(undefined);
    render(panel(10));
    act(() => void firstControl("c2").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c2")));
    click(await button("comments.resolve", "c1"));
    await waitFor(async () => expect(await firstControl("c3")).toBeDisabled());
    rig.threads = [thread("c1"), thread("c3")];
    await gone("c2");
    await act(async () => finish());
    await screen.findByText(en("comments.stateResolved"));
    // Resolve was third; the resolved thread offers Reply, Reopen, Delete.
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")));
  });

  it("waits for the controls to be enabled when the pressed thread left and the action was refused, never skipping to the add box", async () => {
    rig.threads = [thread("c1"), thread("c2"), thread("c3")];
    let refuse: () => void = () => undefined;
    rig.answer = (command) =>
      command === "comment_user_resolve"
        ? new Promise((_, reject) => {
            refuse = () => reject(new JournalRefusal("STALE_COMMENT", "gone"));
          })
        : Promise.resolve(undefined);
    render(panel(10));
    await press(await button("comments.resolve", "c2"));
    await waitFor(async () => expect(await firstControl("c3")).toBeDisabled());
    rig.threads = [thread("c1"), thread("c3")];
    await gone("c2");
    await frames();
    expect(document.activeElement).toBe(document.body);
    await act(async () => refuse());
    await waitFor(async () => expect(document.activeElement).toBe(await firstControl("c3")));
  });
});

describe("a failed list read", () => {
  it("leaves the page focused, never the add box, until a read succeeds", async () => {
    render(panel(10));
    act(() => void button("comments.resolve").then((b) => b.focus()));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
    failList(true);
    await screen.findByRole("alert");
    await frames();
    expect(document.activeElement).toBe(document.body);

    failList(false);
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")), { timeout: 3000 });
  });

  it("after a recorded action, waits through the failure for the read that shows the new state", async () => {
    rig.answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
      failList(true);
      return { doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" };
    };
    render(panel());
    click(await button("comments.resolve"));
    await screen.findByRole("alert");
    await frames();
    expect(document.activeElement).toBe(document.body);

    failList(false);
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")), { timeout: 3000 });
    expect(await article()).toBeTruthy();
  });
});
