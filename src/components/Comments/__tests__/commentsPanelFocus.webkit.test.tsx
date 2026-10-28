// WI-AL3.2 — the comments panel's keyboard focus in real WebKit, where a clicked button takes focus only off macOS (a mouse press there then runs as a keyboard press does), a disabled one loses it at the next rendering update and a removed one leaves it on the page: after a recorded action focus waits on the page for the re-read and then goes to the action in the pressed one's place, whether the journal answered within the frame or after it; a refusal or a cancelled delete after a frame lets focus fall and returns it to the pressed button, also when the list read after it never answers, while one answered within the frame never takes focus from a button pressed by keyboard; a panel closed while that is being confirmed moves nothing afterwards; after this window's delete it goes to the thread now in the deleted one's place, and of two quick deletes the second's place decides; a click on the panel's own blank space while an action runs or waits for the re-read is the person's choice and nothing is placed after it; of two overlapping actions the one begun later decides; a thread deleted elsewhere while its reply box had focus, mid-composition too, hands focus to the Deleted comment line's Dismiss, which hands it to the restored reply box when the thread is listed again, and a focused action another window's change removed hands it to the action now in its place; a recorded action whose target another panel's action has disabled waits for it to be enabled; focus a shortcut moves to the editor while an action runs is the person's, so no later re-read takes it back; the panel is mounted as the app mounts it under StrictMode, and also without it
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

type Args = Record<string, unknown>;
const io = vi.hoisted(() => ({
  answer: vi.fn<(command: string, args: Args) => Promise<unknown>>(),
  confirm: vi.fn<() => Promise<boolean>>(),
  create: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@/services/agentJournal/journalTransport", () => ({
  invokeJournal: async (command: string, { callId, ...args }: Args) => ({ bind: { callId }, reply: await io.answer(command, args) }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@/services/dialogs/confirmAction", () => ({ confirmAction: io.confirm }));
vi.mock("@/services/ime/imeToast", () => ({ imeToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/services/persistence/workspaceStorage", async (importOriginal) => ({ ...(await importOriginal<object>()), getCurrentWindowLabel: () => "main" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/services/agentJournal/comments/commentCreate", () => ({
  readCommentSelection: () => ({ mode: "markdown", from: 11, to: 16, selected: "world", text: "# T\n\nhello world\n" }),
  createComment: io.create,
}));

import { useDocumentStore } from "@/stores/documentStore";
import { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { CommentThread, ThreadState } from "@/services/agentJournal/comments/commentReplies";
import { CommentsPanel } from "../CommentsPanel";
import { forgetCommentDrafts } from "../commentDrafts";
import { releaseCommentAction, takeCommentAction } from "../commentActionLock";
import { webkitClickFocusesButton } from "@/test/focusFacts";

const TAB = "t-1";
const KEY = "path:/a.md";
const DOC = "0190d3c4-0000-7000-8000-0000000000d1";
type How = "keyboard" | "mouse";
const HOW: How[] = ["keyboard", "mouse"];
const MOUNTS = [["StrictMode", true] as const, ["no StrictMode", false] as const];

const thread = (comment: string, state: ThreadState = "open", commentGen = "2"): CommentThread => ({
  comment,
  state,
  commentGen,
  revision: "0190d3c4-0000-7000-8000-000000000011",
  creationRetained: true,
  quote: `quote of ${comment}`,
  body: `body of ${comment}`,
  author: "",
  caller: "user",
  replies: [],
  anchor: { status: "resolved", tier: "context", start: 5, end: 10, byHint: true },
});
const resolved = (...comments: string[]) => comments.map((c) => thread(c, "resolved"));

let threads: CommentThread[] = [];
let held: Array<() => void> | null = null;
const listAnswer = () => ({ doc: DOC, generation: "3", threads });
const readList = () => (held === null ? Promise.resolve(listAnswer()) : new Promise((resolve) => held?.push(() => resolve(listAnswer()))));
/** Hold every list read until `releaseList()`. */
const holdList = () => {
  held ??= [];
};
const releaseList = () => {
  const waiting = held ?? [];
  held = null;
  for (const answer of waiting) answer();
};
/** How the journal answers every call but the list read. */
let answer: (command: string, args: Args) => Promise<unknown> = async () => undefined;
const calls = (command: string) => io.answer.mock.calls.filter(([c]) => c === command).length;

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(strict = true, pollMs: number | null = null): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const panel = <CommentsPanel tabId={TAB} docKey={KEY} pollMs={pollMs} />;
  flushSync(() => root?.render(strict ? <StrictMode>{panel}</StrictMode> : panel));
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Resolves after the next rendering update, so a control disabled meanwhile has lost focus. */
const afterFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const frames = async (n = 2) => {
  for (let i = 0; i < n; i++) await nextFrame();
};
const control = (comment: string, name: string) => document.querySelector<HTMLElement>(`li[data-comment="${comment}"] [data-focus="${name}"]`);
/** `name` in `comment`'s thread, once rendered. */
async function find(name: string, comment = "c1"): Promise<HTMLElement> {
  await expect.poll(() => control(comment, name)).not.toBeNull();
  return control(comment, name) as HTMLElement;
}
const firstControl = (comment: string) => document.querySelector(`li[data-comment="${comment}"] button`);
const focused = () => document.activeElement;
/** Wait until the control `target` finds (looked up again on every poll) has focus. */
const focusMovesTo = (target: () => Element | null) => expect.poll(() => target() !== null && focused() === target()).toBe(true);
const gone = (comment: string) => expect.poll(() => document.querySelector(`li[data-comment="${comment}"]`)).toBeNull();
const shows = (comment: string, state: ThreadState) => expect.poll(() => document.querySelector(`li[data-comment="${comment}"] article`)?.getAttribute("data-state")).toBe(state);
/** Focus arriving at and leaving the panel's controls from now on, as `in:name` and `out:name`. */
function focusTrail(): string[] {
  const trail: string[] = [];
  for (const [type, tag] of [["focusin", "in"], ["focusout", "out"]] as const) {
    host?.addEventListener(type, (e) => trail.push(`${tag}:${(e.target as HTMLElement).dataset.focus ?? "?"}`));
  }
  return trail;
}
async function activate(el: HTMLElement, how: How): Promise<void> {
  if (how === "mouse") return userEvent.click(el);
  el.focus();
  await userEvent.keyboard("{Enter}");
}
const changed = (comment: string, state: ThreadState) => ({ doc: DOC, comment, state, generation: "4", commentGen: "3" });
/** Resolve on c1 waits for the returned function; the journal then lists c1 resolved. */
function heldResolve(): () => void {
  let finish: () => void = () => undefined;
  answer = (command) =>
    command === "comment_user_resolve"
      ? new Promise((resolve) => {
          finish = () => {
            threads = [thread("c1", "resolved", "3")];
            resolve(changed("c1", "resolved"));
          };
        })
      : Promise.resolve(undefined);
  return () => finish();
}
/** Resolve is refused once `after` resolves. */
const refuseResolve = (after: () => Promise<void>) => {
  answer = async (command) => {
    if (command !== "comment_user_resolve") return undefined;
    await after();
    throw new JournalRefusal("STALE_COMMENT", "moved");
  };
};


beforeEach(() => {
  vi.clearAllMocks();
  forgetCommentDrafts();
  releaseCommentAction(KEY);
  threads = [thread("c1")];
  held = null;
  answer = async () => undefined;
  io.answer.mockImplementation((command, args) => (command === "comment_user_list" ? readList() : answer(command, args)));
  useDocumentStore.setState({ documents: {} });
  useDocumentStore.getState().initDocument(TAB, "# T\n\nhello world\n", "/a.md");
});

afterEach(() => {
  releaseList();
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe("after a recorded action", () => {
  describe.each(MOUNTS)("%s", (_mount, strict) => {
    it.each(HOW)("the page holds focus until the re-read, then the action in the pressed one's place has it (%s)", async (how) => {
      answer = async (command) => {
        if (command !== "comment_user_mark_addressed") return undefined;
        threads = [thread("c1", "addressed", "3")];
        await afterFrame();
        return changed("c1", "addressed");
      };
      mount(strict);
      const mark = await find("markAddressed");
      holdList();
      await activate(mark, how);
      await expect.poll(() => calls("comment_user_mark_addressed")).toBe(1);
      await expect.poll(() => (mark as HTMLButtonElement).disabled).toBe(false);
      await frames();
      expect(focused()).toBe(document.body);
      releaseList();
      await shows("c1", "addressed");
      await focusMovesTo(() => control("c1", "resolve"));
    });
  });

  it("the action in the pressed one's place has it when the journal answered within the frame", async () => {
    answer = async (command) => {
      if (command !== "comment_user_mark_addressed") return undefined;
      threads = [thread("c1", "addressed", "3")];
      // Answered inside the frame's callbacks: the button is enabled again before the update that would blur it.
      await nextFrame();
      return changed("c1", "addressed");
    };
    mount();
    const mark = await find("markAddressed");
    holdList();
    await activate(mark, "keyboard");
    await expect.poll(() => calls("comment_user_mark_addressed")).toBe(1);
    await frames();
    releaseList();
    await shows("c1", "addressed");
    await focusMovesTo(() => control("c1", "resolve"));
  });
});

/**
 * The focus trail of a mouse press on `name`. Where a click focuses the button
 * (`webkitClickFocusesButton`), the press starts as a keyboard one does, so
 * the keyboard trail follows the click's own `in`; on macOS only the return.
 */
const byMouse = (name: string, keyboard: string[]): string[] =>
  webkitClickFocusesButton() ? [`in:${name}`, ...keyboard] : [`in:${name}`];

describe("after an action that changed nothing", () => {
  /**
   * The focus events after the press, not only where focus ends: a keyboard
   * press starts on the button, so an end state alone cannot tell focus that
   * returned from focus that never left.
   */
  const pressed = async (name: string, how: How) => {
    const el = await find(name);
    if (how === "keyboard") el.focus();
    return { el, trail: focusTrail() };
  };

  it.each<[How, string[]]>([
    ["keyboard", ["out:resolve", "in:resolve"]],
    ["mouse", byMouse("resolve", ["out:resolve", "in:resolve"])],
  ])("a refusal after a frame: focus falls to the page and returns to the pressed button (%s)", async (how, trail) => {
    refuseResolve(afterFrame);
    mount();
    const { el, trail: seen } = await pressed("resolve", how);
    await activate(el, how);
    await expect.poll(() => seen).toEqual(trail);
    await frames(3);
    expect({ seen, focus: focused() === el }).toEqual({ seen: trail, focus: true });
  });

  // A re-enable before the rendering update loses no focus (the F2c fact): by keyboard there is nothing to return.
  it.each<[How, string[]]>([
    ["keyboard", []],
    ["mouse", ["in:resolve"]],
  ])("a refusal within the frame: focus stays on, or goes to, the pressed button (%s)", async (how, trail) => {
    refuseResolve(nextFrame);
    mount();
    const { el, trail: seen } = await pressed("resolve", how);
    await activate(el, how);
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    await frames(3);
    expect({ seen, focus: focused() === el }).toEqual({ seen: trail, focus: true });
  });

  it("closing the panel while focus is being confirmed on the pressed button moves nothing afterwards", async () => {
    refuseResolve(nextFrame);
    mount();
    await activate(await find("resolve"), "keyboard");
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    // The refusal lands in this frame's callbacks; its commit follows in a task, starting the two-frame confirm.
    await nextFrame();
    await new Promise((resolve) => setTimeout(resolve, 0));
    root?.unmount();
    root = null;
    const editor = document.createElement("button");
    document.body.append(editor);
    editor.focus();
    await frames(3);
    expect(focused()).toBe(editor);
    editor.remove();
  });

  it.each<["after a frame" | "at once", How, string[]]>([
    ["after a frame", "keyboard", ["out:delete", "in:delete"]],
    ["after a frame", "mouse", byMouse("delete", ["out:delete", "in:delete"])],
    ["at once", "keyboard", []],
    ["at once", "mouse", ["in:delete"]],
  ])("a delete whose confirmation is cancelled %s: focus ends on Delete (%s)", async (when, how, trail) => {
    threads = resolved("c1");
    io.confirm.mockImplementation(async () => {
      if (when === "after a frame") await afterFrame();
      return false;
    });
    mount();
    const { el, trail: seen } = await pressed("delete", how);
    await activate(el, how);
    await expect.poll(() => io.confirm.mock.calls.length).toBe(1);
    await expect.poll(() => seen).toEqual(trail);
    await frames(3);
    expect({ seen, focus: focused() === el, disabled: (el as HTMLButtonElement).disabled }).toEqual({ seen: trail, focus: true, disabled: false });
    expect(calls("comment_user_delete")).toBe(0);
  });

  it.each([
    ["an instant refusal", "resolve"],
    ["an instant cancel", "delete"],
  ])("focus returns after %s though the list read after it never answers", async (_what, name) => {
    threads = name === "delete" ? resolved("c1") : [thread("c1")];
    io.confirm.mockResolvedValue(false);
    refuseResolve(async () => undefined);
    mount();
    const pressed = await find(name);
    holdList();
    await activate(pressed, "mouse");
    await expect.poll(focused).toBe(pressed);
  });
});

describe("after this window's delete", () => {
  describe.each(MOUNTS)("%s", (_mount, strict) => {
    it("focus goes to the thread now in the deleted one's place (mouse)", async () => {
      threads = resolved("c1", "c2");
      io.confirm.mockResolvedValue(true);
      answer = async (command) => {
        if (command !== "comment_user_delete") return undefined;
        threads = resolved("c2");
        await afterFrame();
        return { doc: DOC, comment: "c1", generation: "5" };
      };
      mount(strict);
      await activate(await find("delete"), "mouse");
      await gone("c1");
      await focusMovesTo(() => firstControl("c2"));
    });
  });

  it("of two quick deletes, the second's place decides", async () => {
    threads = resolved("c1", "c2", "c3", "c4");
    io.confirm.mockResolvedValue(true);
    answer = async (command, args) => {
      if (command !== "comment_user_delete") return undefined;
      const { comment } = JSON.parse(String(args.payload)) as { comment: string };
      threads = threads.filter((t) => t.comment !== comment);
      return { doc: DOC, comment, generation: "5" };
    };
    mount();
    const first = await find("delete", "c1");
    holdList();
    await activate(first, "mouse");
    await expect.poll(() => calls("comment_user_delete")).toBe(1);
    await expect.poll(() => (first as HTMLButtonElement).disabled).toBe(false);
    const second = await find("delete", "c2");
    await activate(second, "mouse");
    await expect.poll(() => calls("comment_user_delete")).toBe(2);
    await expect.poll(() => (second as HTMLButtonElement).disabled).toBe(false);
    releaseList();
    await gone("c2");
    await focusMovesTo(() => firstControl("c4"));
  });
});

describe("a click on the panel's blank space", () => {
  const blank = () => document.querySelector<HTMLElement>(".mcp-history-section__title") as HTMLElement;

  it.each(HOW)("while the action runs: nothing is placed when it ends (%s)", async (how) => {
    const finish = heldResolve();
    mount();
    await activate(await find("resolve"), how);
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    await userEvent.click(blank());
    finish();
    await shows("c1", "resolved");
    await expect.poll(() => (control("c1", "delete") as HTMLButtonElement | null)?.disabled).toBe(false);
    await frames();
    expect(focused()).toBe(document.body);
  });

  it.each(HOW)("while focus waits for the re-read: nothing is placed when the list arrives (%s)", async (how) => {
    const finish = heldResolve();
    mount();
    const resolve = await find("resolve");
    holdList();
    await activate(resolve, how);
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    finish();
    await expect.poll(() => (resolve as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(blank());
    releaseList();
    await shows("c1", "resolved");
    await frames();
    expect(focused()).toBe(document.body);
  });
});

describe("two overlapping actions", () => {
  it.each(HOW)("the resolve begun after a create decides focus, though the create finishes last (%s)", async (how) => {
    let created: () => void = () => undefined;
    io.create.mockImplementation(() => new Promise((resolve) => (created = () => resolve({ status: "created", created: {} }))));
    answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      threads = [thread("c1", "resolved", "3")];
      await afterFrame();
      return changed("c1", "resolved");
    };
    mount();
    const add = () => document.querySelector<HTMLElement>('[data-focus="addButton"]');
    await expect.poll(add).not.toBeNull();
    await activate(add() as HTMLElement, "keyboard");
    await expect.poll(() => document.querySelector('[data-focus="addBody"]')).not.toBeNull();
    await userEvent.fill(document.querySelector('[data-focus="addBody"]') as HTMLElement, "note");
    await activate(document.querySelector('[data-focus="addSubmit"]') as HTMLElement, "keyboard");
    await expect.poll(() => io.create.mock.calls.length).toBe(1);

    holdList();
    const resolve = await find("resolve");
    await activate(resolve, how);
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    await expect.poll(() => (resolve as HTMLButtonElement).disabled).toBe(false);
    // Focus waits on the page for the re-read; the create's answer must not take it.
    created();
    await expect.poll(add).not.toBeNull();
    await frames();
    expect(focused()).toBe(document.body);

    releaseList();
    await shows("c1", "resolved");
    // Resolve was third; the resolved thread offers Reply, Reopen, Delete.
    await focusMovesTo(() => control("c1", "delete"));
  });
});

describe("a thread changed elsewhere", () => {
  it.each([
    ["", false],
    [" mid-composition", true],
  ])("deleted while its reply box had focus%s: Dismiss takes focus", async (_what, composing) => {
    threads = [thread("c1"), thread("c2")];
    mount(true, 10);
    await activate(await find("reply"), "mouse");
    const box = await find("replyBox");
    await expect.poll(focused).toBe(box);
    await userEvent.keyboard("half");
    if (composing) box.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    threads = [thread("c2")];
    await focusMovesTo(() => document.querySelector('[data-focus="dismiss"]'));
  });

  it("deleted while its reply box had focus, then listed again: the restored reply box takes focus from Dismiss", async () => {
    threads = [thread("c1"), thread("c2")];
    mount(true, 10);
    await activate(await find("reply"), "mouse");
    await expect.poll(focused).toBe(await find("replyBox"));
    threads = [thread("c2")];
    await focusMovesTo(() => document.querySelector('[data-focus="dismiss"]'));
    threads = [thread("c1"), thread("c2")];
    await focusMovesTo(() => control("c1", "replyBox"));
  });

  it("resolved elsewhere while its Resolve had focus: the action now in its place has it", async () => {
    mount(true, 10);
    const resolve = await find("resolve");
    resolve.focus();
    threads = [thread("c1", "resolved", "3")];
    await shows("c1", "resolved");
    await focusMovesTo(() => control("c1", "delete"));
  });
});

describe("a recorded action whose target another action has disabled", () => {
  it.each(HOW)("waits for the target to be enabled, then focus goes there (%s)", async (how) => {
    answer = async (command) => {
      if (command !== "comment_user_resolve") return undefined;
      threads = [thread("c1", "resolved", "3")];
      await afterFrame();
      return changed("c1", "resolved");
    };
    mount();
    const resolve = await find("resolve");
    holdList();
    await activate(resolve, how);
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    await expect.poll(() => (resolve as HTMLButtonElement).disabled).toBe(false);
    // Another panel's action on the document takes the shared lock before the re-read arrives.
    flushSync(() => expect(takeCommentAction(KEY)).toBe(true));
    releaseList();
    await shows("c1", "resolved");
    await frames(3);
    expect({ disabled: (control("c1", "delete") as HTMLButtonElement).disabled, focus: focused() }).toEqual({ disabled: true, focus: document.body });
    flushSync(() => releaseCommentAction(KEY));
    await focusMovesTo(() => control("c1", "delete"));
  });
});

describe("focus the app moves elsewhere while an action runs", () => {
  it("is the person's: when it later falls to the page, a re-read places nothing", async () => {
    const finish = heldResolve();
    mount(true, 10);
    await activate(await find("resolve"), "keyboard");
    await expect.poll(() => calls("comment_user_resolve")).toBe(1);
    await expect.poll(focused).toBe(document.body);
    // A shortcut's handler focuses the editor: no pointer press, no Tab, no blur from the panel.
    const editor = document.createElement("button");
    document.body.append(editor);
    editor.focus();
    finish();
    await shows("c1", "resolved");
    await frames(3);
    expect(focused()).toBe(editor);
    editor.blur();
    const reads = calls("comment_user_list");
    await expect.poll(() => calls("comment_user_list")).toBeGreaterThan(reads + 1);
    await frames(3);
    editor.remove();
    expect(focused()).toBe(document.body);
  });
});
