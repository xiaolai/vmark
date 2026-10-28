// WI-AL3.2 — which interaction's focus wins in the comments panel: a click on blank panel space while an action is under way (before or after its pressed button lost focus), or while its focus waits for the re-read, is the person's choice and the action places nothing afterwards; of two overlapping actions the one begun later decides where focus goes, whichever finishes last (a slow create begun before a resolve does not pull focus to the add box); an action that ends at once with a refusal or a cancelled delete returns focus to the pressed button even when no list read follows it; a recorded action whose target another action has disabled when the re-read arrives waits for it to be enabled; and focus the app moves to the editor while an action runs is the person's, so when it later falls to the page no re-read takes it back
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: toast }));

import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { answerPrepare } from "@/test/agentJournalWireFake";
import { nextFrame } from "@/test/webkitFocusModel";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import { DOC, addButton, activate, busyElsewhere, button, click, editorSelection, en, holdList, outside, panel, press, releaseList, rig, slow, thread, installCommentRig, type How } from "./commentFocusRig";

installCommentRig();

const HOW: How[] = ["keyboard", "mouse"];
const calls = (command: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === command).length;
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await act(() => nextFrame());
};
const blank = () => screen.getByRole("region", { name: en("comments.title") });
/** Resolve on c1 answers when the test calls the returned function; the journal then lists c1 resolved. */
const heldResolve = () => {
  const finish = { now: () => undefined as void };
  rig.answer = (command) =>
    command === "comment_user_resolve"
      ? new Promise((resolve) => {
          finish.now = () => {
            rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
            resolve({ doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" });
          };
        })
      : Promise.resolve(undefined);
  return finish;
};

describe("a click on blank panel space", () => {
  it.each(HOW)("while the action is under way: the action places nothing when it ends (%s)", async (how) => {
    const finish = heldResolve();
    render(panel());
    await activate(await button("comments.resolve"), how);
    await waitFor(() => expect(calls("comment_user_resolve")).toBe(1));
    click(blank());
    await act(async () => finish.now());
    await screen.findByText(en("comments.stateResolved"));
    await waitFor(async () => expect(await button("comments.delete")).toBeEnabled());
    await frames();
    expect(document.activeElement).toBe(document.body);
  });

  it("while the action is under way, after its pressed button lost focus: the action places nothing when it ends (keyboard)", async () => {
    const finish = heldResolve();
    render(panel());
    await press(await button("comments.resolve"));
    await waitFor(() => expect(calls("comment_user_resolve")).toBe(1));
    await frames();
    expect(document.activeElement).toBe(document.body);
    // The blur came first and kept the record; this press, with focus already on the page, is what clears it.
    click(blank());
    await act(async () => finish.now());
    await screen.findByText(en("comments.stateResolved"));
    await waitFor(async () => expect(await button("comments.delete")).toBeEnabled());
    await frames();
    expect(document.activeElement).toBe(document.body);
  });

  it.each(HOW)("while focus waits for the re-read: nothing is placed when the list arrives (%s)", async (how) => {
    const finish = heldResolve();
    render(panel());
    const resolve = await button("comments.resolve");
    holdList();
    await activate(resolve, how);
    await waitFor(() => expect(calls("comment_user_resolve")).toBe(1));
    await act(async () => finish.now());
    await waitFor(() => expect(resolve).toBeEnabled());
    click(blank());
    await releaseList();
    await screen.findByText(en("comments.stateResolved"));
    await frames();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("two overlapping actions", () => {
  it.each(HOW)("the resolve begun after a create decides focus, though the create finishes last (%s)", async (how) => {
    editorSelection();
    let created: () => void = () => undefined;
    rig.answer = async (command, args) => {
      if (command === "comment_user_resolve") {
        rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
        return slow({ doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" });
      }
      if (command !== "comment_user_create") return undefined;
      return answerPrepare(
        args,
        () =>
          new Promise((resolve) => {
            created = () =>
              resolve({ doc: DOC, comment: "c7", revision: "0190d3c4-0000-7000-8000-000000000011", textHash: `sha256-${"a".repeat(64)}`, generation: "5", commentGen: "0" });
          }),
      );
    };
    const user = userEvent.setup();
    render(panel());
    await press(await screen.findByRole("button", { name: en("comments.add") }));
    await user.type(screen.getByRole("textbox", { name: en("comments.bodyLabel") }), "note");
    await press(screen.getByRole("button", { name: en("comments.submit") }));
    await waitFor(() => expect(calls("comment_user_create")).toBe(1));

    holdList();
    const resolve = await button("comments.resolve");
    await activate(resolve, how);
    await waitFor(() => expect(calls("comment_user_resolve")).toBe(1));
    await waitFor(() => expect(resolve).toBeEnabled());
    // Focus waits on the page for the re-read; the create's answer must not take it.
    await act(async () => created());
    await waitFor(() => expect(addButton()).toBeEnabled());
    await frames();
    expect(document.activeElement).toBe(document.body);

    await releaseList();
    await screen.findByText(en("comments.stateResolved"));
    // Resolve was third; the resolved thread offers Reply, Reopen, Delete.
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")));
  });
});

describe("an action that ends at once with no list read after it", () => {
  it("returns to Resolve after an instant refusal", async () => {
    rig.answer = async (command) => {
      if (command === "comment_user_resolve") throw new JournalRefusal("STALE_COMMENT", "moved");
    };
    render(panel());
    const resolve = await button("comments.resolve");
    holdList();
    click(resolve);
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(resolve));
  });

  it("returns to Delete after an instant cancel", async () => {
    rig.threads = [thread("c1", { state: "resolved" })];
    vi.mocked(ask).mockResolvedValue(false);
    render(panel());
    const del = await button("comments.delete");
    holdList();
    click(del);
    await waitFor(() => expect(ask).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(del));
  });
});

describe("focus the app moves elsewhere while an action runs", () => {
  it("is the person's: when it later falls to the page, a re-read places nothing", async () => {
    const finish = heldResolve();
    render(panel(10));
    await press(await button("comments.resolve"));
    await waitFor(() => expect(calls("comment_user_resolve")).toBe(1));
    await frames();
    expect(document.activeElement).toBe(document.body);
    // A shortcut's handler focuses the editor: no pointer press, no Tab, no blur from the panel.
    const editor = outside();
    act(() => editor.focus());
    await act(async () => finish.now());
    await screen.findByText(en("comments.stateResolved"));
    await waitFor(async () => expect(await button("comments.delete")).toBeEnabled());
    await frames();
    expect(document.activeElement).toBe(editor);
    act(() => editor.blur());
    const reads = calls("comment_user_list");
    await waitFor(() => expect(calls("comment_user_list")).toBeGreaterThan(reads + 1));
    await frames();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("a recorded action whose target another action has disabled", () => {
  it.each(HOW)("waits for the target to be enabled, then focus goes there (%s)", async (how) => {
    rig.answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      rig.threads = [thread("c1", { state: "resolved", commentGen: "3" })];
      return slow({ doc: DOC, comment: "c1", state: "resolved", generation: "4", commentGen: "3" });
    };
    render(panel());
    const resolve = await button("comments.resolve");
    holdList();
    await activate(resolve, how);
    await waitFor(() => expect(resolve).toBeEnabled());
    // Focus waits for the re-read; before it arrives another panel's action on the document disables every control.
    const release = busyElsewhere();
    await releaseList();
    await screen.findByText(en("comments.stateResolved"));
    await frames();
    expect(await button("comments.delete")).toBeDisabled();
    expect(document.activeElement).toBe(document.body);
    release();
    await waitFor(async () => expect(document.activeElement).toBe(await button("comments.delete")));
  });
});
