// WI-AL3.2 — a thread's reply box and actions keep the person's place, by keyboard and by mouse as WebKit moves focus: the reply being written (and which thread it is for) outlives the panel unmounting — the history popover closing — and is forgotten once cancelled; opening the reply box focuses it, and cancel or a sent reply returns focus to Reply, a refused reply to Send; after a recorded action focus waits for the re-read to show the new state (the page holds focus meanwhile, never the old button) and then goes to the same action, or to the action now in its place, also when the re-read came before the reply; after a refused action or a cancelled delete it returns to the pressed button, or to the action now in its place when the re-read moved the thread; a reply fast enough that the pressed button never lost focus leaves it there; focus moved out of the panel while an action or a reply was under way is not taken back, and once dropped nothing is placed by a later re-read
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { nextFrame } from "@/test/webkitFocusModel";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { ThreadState } from "@/services/agentJournal/comments/commentReplies";
import { DOC, activate, article, button, click, en, holdList, outside, panel, releaseList, replyBox, rig, slow, thread, installCommentRig, type How } from "./commentFocusRig";

installCommentRig();

const HOW: How[] = ["keyboard", "mouse"];
const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === command).length;
const changed = (state: ThreadState) => ({ doc: DOC, comment: "c1", state, generation: "4", commentGen: "3" });
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await act(() => nextFrame());
};
/** Mark addressed on c1 is recorded, after a frame, and the journal then lists c1 addressed. */
const markAddressedRecorded = () => {
  rig.answer = async (command) => {
    if (command !== "comment_user_mark_addressed") return undefined;
    rig.threads = [thread("c1", { state: "addressed", commentGen: "3" })];
    return slow(changed("addressed"));
  };
};

describe("a thread's reply draft", () => {
  it("outlives the panel unmounting, and is forgotten once cancelled", async () => {
    const user = userEvent.setup();
    const first = render(panel());
    click(await button("comments.reply"));
    await user.type(replyBox(), "half a reply");
    first.unmount();

    const second = render(panel());
    await article();
    expect(replyBox()).toHaveValue("half a reply");
    click(screen.getByRole("button", { name: en("comments.cancel") }));
    second.unmount();

    render(panel());
    click(await button("comments.reply"));
    expect(replyBox()).toHaveValue("");
  });
});

describe("focus around the reply box", () => {
  it.each(HOW)("focuses the box when it opens, and returns to Reply on cancel and after a recorded reply (%s)", async (how) => {
    rig.answer = async (command, args) => (command === "comment_user_reply" ? answerPrepare(args, () => slow({ doc: DOC, comment: "c1", reply: "r4", generation: "4", commentGen: "3" })) : undefined);
    const user = userEvent.setup();
    render(panel());

    await activate(await button("comments.reply"), how);
    await waitFor(() => expect(document.activeElement).toBe(replyBox()));
    await activate(screen.getByRole("button", { name: en("comments.cancel") }), how);
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.reply")));

    await activate(await button("comments.reply"), how);
    await user.type(replyBox(), "done");
    await activate(screen.getByRole("button", { name: en("comments.sendReply") }), how);
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.reply")));
  });

  it.each(HOW)("returns to Send when the reply is refused (%s)", async (how) => {
    rig.answer = async (command, args) =>
      command === "comment_user_reply"
        ? answerPrepare(args, async () => {
            await nextFrame();
            throw new JournalRefusal("STALE_COMMENT", "moved");
          })
        : undefined;
    const user = userEvent.setup();
    render(panel());
    await activate(await button("comments.reply"), how);
    await user.type(replyBox(), "done");
    const send = screen.getByRole("button", { name: en("comments.sendReply") });
    await activate(send, how);
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("comments.refusedStale")));
    await waitFor(() => expect(document.activeElement).toBe(send));
    expect(send).toBeEnabled();
  });
});

describe("focus after a recorded action", () => {
  it.each(HOW)("leaves the page focused until the re-read shows the new state, then moves to the action in the pressed one's place (%s)", async (how) => {
    markAddressedRecorded();
    render(panel());
    const mark = await button("comments.markAddressed");
    holdList();
    await activate(mark, how);
    await waitFor(() => expect(calls("comment_user_mark_addressed")).toBe(1));
    await waitFor(() => expect(mark).toBeEnabled());
    await frames();
    // The list still shows the state the action moved past: no control of it is the place for focus.
    expect(document.activeElement).toBe(document.body);

    await releaseList();
    await screen.findByText(en("comments.stateAddressed"));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
  });

  it.each(HOW)("moves to the action in its place when the re-read came before the reply (%s)", async (how) => {
    let finish: () => void = () => undefined;
    rig.answer = (command) =>
      command === "comment_user_mark_addressed"
        ? new Promise((resolve) => {
            rig.threads = [thread("c1", { state: "addressed", commentGen: "3" })];
            finish = () => resolve(changed("addressed"));
          })
        : Promise.resolve(undefined);
    render(panel(10));
    await activate(await button("comments.markAddressed"), how);
    await screen.findByText(en("comments.stateAddressed"));
    expect(document.activeElement).toBe(document.body);
    await act(async () => finish());
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
  });
});

describe("focus after an action that changed nothing", () => {
  it.each(HOW)("returns to the pressed button when the action is refused (%s)", async (how) => {
    rig.answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      await nextFrame();
      throw new JournalRefusal("STALE_COMMENT", "moved");
    };
    render(panel());
    await activate(await button("comments.resolve"), how);
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(en("comments.refusedStale")));
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.resolve")));
  });

  it.each(HOW)("moves to the action now in the pressed one's place when the refusal's re-read moved the thread (%s)", async (how) => {
    rig.answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
      await nextFrame();
      throw new JournalRefusal("STALE_COMMENT", "moved");
    };
    render(panel());
    await activate(await button("comments.resolve"), how);
    await screen.findByText(en("comments.stateResolved"));
    // Resolve was third; the resolved thread offers Reply, Reopen, Delete.
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")));
  });

  it.each(HOW)("returns to Delete when the confirmation is cancelled (%s)", async (how) => {
    rig.threads = [thread("c1", { state: "resolved" })];
    vi.mocked(ask).mockImplementation(async () => {
      await nextFrame();
      return false;
    });
    render(panel());
    const del = await button("comments.delete");
    await activate(del, how);
    await waitFor(() => expect(ask).toHaveBeenCalled());
    await waitFor(() => {
      expect(del).toBeEnabled();
      expect(document.activeElement).toBe(del);
    });
    expect(calls("comment_user_delete")).toBe(0);
  });

  it("stays on the pressed button when the refusal arrives before it lost focus", async () => {
    rig.answer = async (command) => {
      if (command === "comment_user_resolve") throw new JournalRefusal("STALE_COMMENT", "moved");
    };
    render(panel());
    const resolve = await button("comments.resolve");
    await activate(resolve, "keyboard");
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    await frames(3);
    expect(document.activeElement).toBe(resolve);
  });
});

describe("focus the person moved while an action was under way", () => {
  it.each([
    ["an action", "comments.markAddressed", "comment_user_mark_addressed"],
    ["a reply", "comments.sendReply", "comment_user_reply"],
  ])("is not taken back when it left the panel during %s, nor by a later re-read once it falls to the page", async (_what, key, call) => {
    let finish: (() => void) | null = null;
    const done = () =>
      new Promise((resolve) => {
        finish = () => {
          const reply = call === "comment_user_reply";
          rig.threads = [thread("c1", { state: reply ? "open" : "addressed", commentGen: "3" })];
          resolve({ doc: DOC, comment: "c1", ...(reply ? { reply: "r4" } : { state: "addressed" }), generation: "4", commentGen: "3" });
        };
      });
    rig.answer = async (command, args) => {
      if (command !== call) return undefined;
      return call === "comment_user_reply" ? answerPrepare(args, done) : done();
    };
    const user = userEvent.setup();
    render(panel(10));
    if (call === "comment_user_reply") {
      click(await button("comments.reply"));
      await user.type(replyBox(), "done");
      click(screen.getByRole("button", { name: en(key) }));
    } else click(await button(key));
    await waitFor(() => expect(finish).not.toBeNull());

    const editor = outside();
    act(() => editor.focus());
    await act(async () => finish?.());
    await waitFor(async () => expect(within(await article()).queryByRole("button", { name: en(key) })).toBeNull());
    await waitFor(async () => expect(await button("comments.reply")).toBeEnabled());
    expect(document.activeElement).toBe(editor);

    // Focus falls to the page for the person's own reasons; the polls that follow place nothing.
    act(() => editor.blur());
    const reads = calls("comment_user_list");
    await waitFor(() => expect(calls("comment_user_list")).toBeGreaterThan(reads + 1));
    await frames();
    expect(document.activeElement).toBe(document.body);
  });
});
