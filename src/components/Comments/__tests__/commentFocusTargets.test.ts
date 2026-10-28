// WI-AL3.2 — where a focus intent lands in the comments panel, read from the DOM alone: a named add-box control, else the add box's first control; a named thread control, else the thread action at the pressed one's index (clamped to the last), else the thread's first control; a thread no longer listed is a leave; a leave goes to the Deleted comment line's Dismiss when the thread was being replied to, else the thread now in its place, else the one before, else the add box; a dismissed line goes to the first thread, else the add box; it waits while the target is missing or disabled (never skipping a disabled control for a later one), while a left thread is still listed, and while the thread still shows the generation the action was pressed on, an older one or none (compared as numbers); while no list is loaded every thread intent waits; a left thread with no recorded place waits; focus that was on Dismiss goes, once a loaded list no longer shows the line, to the reply box of the thread being replied to when that thread is listed again (waiting until it renders), else to the add box's first enabled control, and waits while no list is loaded; with a draft open the add box's first control is its body
import { describe, it, expect, beforeEach } from "vitest";
import { targetFor, type FocusIntent, type TargetContext } from "../commentFocusTargets";

interface ThreadSpec {
  id: string;
  /** The rendered `data-comment-gen`; `null` renders none. */
  gen?: string | null;
  /** Action buttons, in order; a `!` suffix renders the button disabled. */
  actions?: string[];
  /** Extra named controls inside the thread. */
  controls?: string[];
}
interface PanelSpec {
  threads: ThreadSpec[];
  /** Named controls of the add box; a `!` suffix renders it disabled; `addBody` is the draft's textarea. */
  add?: string[];
  line?: boolean;
  /** The panel's `data-list`: whether a list is loaded. */
  list?: "loaded" | "none";
}

const button = (name: string, attr: string) => {
  const disabled = name.endsWith("!");
  const bare = disabled ? name.slice(0, -1) : name;
  const tag = bare === "addBody" ? "textarea" : "button";
  return `<${tag} ${attr}="${bare}" id="${bare}"${disabled ? " disabled" : ""}></${tag}>`;
};

let root: HTMLElement;
function mount(spec: PanelSpec): void {
  const line = spec.line ? `<p>${button("dismiss", "data-focus")}</p>` : "";
  const add = `<div class="comments-panel__add">${(spec.add ?? ["addButton"]).map((n) => button(n, "data-focus")).join("")}</div>`;
  const items = spec.threads
    .map((t) => {
      const actions = (t.actions ?? ["reply", "resolve", "delete"]).map((a) => button(a, "data-action").replace(/id="([^"]+)"/, `id="${t.id}-$1" data-focus="$1"`));
      const controls = (t.controls ?? []).map((c) => (c === "replyBox" ? `<textarea data-focus="replyBox" id="${t.id}-replyBox"></textarea>` : button(c, "data-focus").replace(/id="([^"]+)"/, `id="${t.id}-$1"`)));
      const gen = t.gen === null ? "" : ` data-comment-gen="${t.gen ?? "2"}"`;
      return `<li data-comment="${t.id}"${gen}>${controls.concat(actions).join("")}</li>`;
    })
    .join("");
  root.dataset.list = spec.list ?? "loaded";
  root.innerHTML = `${add}${line}<ul class="comments-panel__list">${items}</ul>`;
}

const ctx = (over: Partial<TargetContext> = {}): TargetContext => ({ root, replyingTo: null, seen: new Map(), ...over });
const control = (scope: string, name: string, index = 0, afterGen: string | null = null): FocusIntent => ({ kind: "control", scope, name, index, afterGen });
const leave = (comment: string): FocusIntent => ({ kind: "leave", comment });
const LINE: FocusIntent = { kind: "line" };
const seen = (...order: string[]) => new Map(order.map((c, i) => [c, i]));
const three = ["c1", "c2", "c3"].map((id) => ({ id }));

/** The id of the chosen element, or "wait". */
const pick = (intent: FocusIntent, context: TargetContext = ctx()) => {
  const target = targetFor(intent, context);
  return target === "wait" ? "wait" : target.id;
};

beforeEach(() => {
  root = document.createElement("section");
  document.body.replaceChildren(root);
});

describe("targetFor — the add box", () => {
  it.each<[string, PanelSpec, string, string]>([
    ["the named control", { threads: [], add: ["addBody", "addCancel", "addSubmit"] }, "addSubmit", "addSubmit"],
    ["the first control when the name is gone", { threads: [], add: ["addButton"] }, "addSubmit", "addButton"],
    ["wait when the named control is disabled", { threads: [], add: ["addBody", "addCancel", "addSubmit!"] }, "addSubmit", "wait"],
    ["wait when the first control is disabled", { threads: [], add: ["addButton!"] }, "addSubmit", "wait"],
    ["the draft's body when a draft is open and the button is gone", { threads: [], add: ["addBody", "addCancel", "addSubmit!"] }, "addButton", "addBody"],
    ["the named control while no list is loaded", { threads: [], add: ["addButton"], list: "none" }, "addButton", "addButton"],
  ])("%s", (_what, spec, name, expected) => {
    mount(spec);
    expect(pick(control("add", name))).toBe(expected);
  });

  it("waits when the add box has no control", () => {
    mount({ threads: [], add: [] });
    expect(pick(control("add", "addButton"))).toBe("wait");
  });
});

describe("targetFor — a thread control", () => {
  it.each<[string, ThreadSpec, FocusIntent, string]>([
    ["the named control", { id: "c1" }, control("c1", "resolve", 1), "c1-resolve"],
    ["a named control that is not an action", { id: "c1", controls: ["replySend"] }, control("c1", "replySend"), "c1-replySend"],
    ["the action at the pressed one's index when the name is gone", { id: "c1", actions: ["reply", "reopen", "delete"] }, control("c1", "resolve", 2), "c1-delete"],
    ["the last action when the index is past the end", { id: "c1", actions: ["reply", "resolve"] }, control("c1", "markAddressed", 4), "c1-resolve"],
    ["the thread's first control when no action is rendered", { id: "c1", actions: [], controls: ["replyBox"] }, control("c1", "reply"), "c1-replyBox"],
    ["wait while the thread shows the generation the action was pressed on", { id: "c1", gen: "2" }, control("c1", "resolve", 1, "2"), "wait"],
    ["the target once the generation has moved", { id: "c1", gen: "3" }, control("c1", "resolve", 1, "2"), "c1-resolve"],
    ["wait while the named control is disabled", { id: "c1", actions: ["reply!", "resolve!", "delete!"] }, control("c1", "resolve", 1), "wait"],
    ["wait while the index fallback is disabled", { id: "c1", actions: ["reply!", "reopen!", "delete!"] }, control("c1", "resolve", 2), "wait"],
    ["wait while the thread renders no generation", { id: "c1", gen: null }, control("c1", "resolve", 1, "2"), "wait"],
    ["wait while the thread shows an older generation", { id: "c1", gen: "1" }, control("c1", "resolve", 1, "2"), "wait"],
    ["generations compare as numbers, not text", { id: "c1", gen: "10" }, control("c1", "resolve", 1, "9"), "c1-resolve"],
    ["the target when nothing was recorded, whatever the generation", { id: "c1", gen: null }, control("c1", "resolve", 1), "c1-resolve"],
  ])("%s", (_what, spec, intent, expected) => {
    mount({ threads: [spec] });
    expect(pick(intent)).toBe(expected);
  });

  it("is a leave when the thread is no longer listed", () => {
    mount({ threads: [{ id: "c1" }, { id: "c3" }] });
    expect(pick(control("c2", "resolve", 1), ctx({ seen: seen("c1", "c2", "c3") }))).toBe("c3-reply");
  });
});

describe("targetFor — a thread that left", () => {
  it("waits while the list still holds it", () => {
    mount({ threads: three });
    expect(pick(leave("c2"), ctx({ seen: seen("c1", "c2", "c3") }))).toBe("wait");
  });

  it("goes to the thread now in its place", () => {
    mount({ threads: [{ id: "c1" }, { id: "c3" }] });
    expect(pick(leave("c2"), ctx({ seen: seen("c1", "c2", "c3") }))).toBe("c3-reply");
  });

  it("goes to the thread before it when it was the last", () => {
    mount({ threads: [{ id: "c1" }, { id: "c2" }] });
    expect(pick(leave("c3"), ctx({ seen: seen("c1", "c2", "c3") }))).toBe("c2-reply");
  });

  it("goes to the add box when no thread is left", () => {
    mount({ threads: [], add: ["addButton"] });
    expect(pick(leave("c1"), ctx({ seen: seen("c1") }))).toBe("addButton");
  });

  it("goes to the Deleted comment line's Dismiss when it was being replied to", () => {
    mount({ threads: [{ id: "c2" }], line: true });
    expect(pick(leave("c1"), ctx({ replyingTo: "c1", seen: seen("c1", "c2") }))).toBe("dismiss");
  });

  it("goes to its neighbour when it was being replied to but no Dismiss is rendered", () => {
    mount({ threads: [{ id: "c2" }] });
    expect(pick(leave("c1"), ctx({ replyingTo: "c1", seen: seen("c1", "c2") }))).toBe("c2-reply");
  });

  it("does not take another thread's Dismiss", () => {
    mount({ threads: [{ id: "c1" }, { id: "c3" }], line: true });
    expect(pick(leave("c2"), ctx({ replyingTo: "c9", seen: seen("c1", "c2", "c3") }))).toBe("c3-reply");
  });

  it("waits while the neighbour's controls are disabled, rather than skipping to the add box", () => {
    mount({ threads: [{ id: "c1" }, { id: "c3", actions: ["reply!", "resolve!", "delete!"] }] });
    expect(pick(leave("c2"), ctx({ seen: seen("c1", "c2", "c3") }))).toBe("wait");
  });
});

describe("targetFor — the dismissed Deleted comment line", () => {
  it("goes to the first thread's first control", () => {
    mount({ threads: three });
    expect(pick(LINE)).toBe("c1-reply");
  });

  it("goes to the add box when no thread is listed", () => {
    mount({ threads: [], add: ["addButton"] });
    expect(pick(LINE)).toBe("addButton");
  });

  it("waits while the first thread's first control is disabled", () => {
    mount({ threads: [{ id: "c1", actions: ["reply!", "resolve", "delete"] }] });
    expect(pick(LINE)).toBe("wait");
  });
});

describe("targetFor — no list loaded", () => {
  it.each<[string, FocusIntent]>([
    ["a thread control", control("c1", "resolve", 1)],
    ["a thread control recorded after an action", control("c1", "resolve", 1, "2")],
    ["a thread that left", leave("c1")],
    ["the dismissed line", LINE],
    ["focus that was on the Deleted comment line's Dismiss", control("line", "dismiss")],
  ])("%s waits rather than taking the add box", (_what, intent) => {
    mount({ threads: [], add: ["addButton"], list: "none" });
    expect(pick(intent, ctx({ seen: seen("c1") }))).toBe("wait");
  });
});

describe("targetFor — a thread with no recorded place", () => {
  it("waits rather than taking the first thread", () => {
    mount({ threads: [{ id: "c1" }, { id: "c3" }] });
    expect(pick(leave("c2"), ctx({ seen: seen("c1", "c3") }))).toBe("wait");
  });
});

describe("targetFor — focus that was on the Deleted comment line's Dismiss", () => {
  const onDismiss = control("line", "dismiss");

  it("stays on Dismiss while the line is rendered", () => {
    mount({ threads: [{ id: "c2" }], line: true });
    expect(pick(onDismiss)).toBe("dismiss");
  });

  it("goes to the add box when a loaded list no longer shows the line and the thread is still absent", () => {
    mount({ threads: [{ id: "c2" }], add: ["addButton"] });
    expect(pick(onDismiss, ctx({ replyingTo: "c1" }))).toBe("addButton");
  });

  it("goes to the restored reply box when the line went because the thread is listed again", () => {
    mount({ threads: [{ id: "c1", controls: ["replyBox"] }, { id: "c2" }], add: ["addButton"] });
    expect(pick(onDismiss, ctx({ replyingTo: "c1" }))).toBe("c1-replyBox");
  });

  it("waits while the thread listed again has not rendered its reply box", () => {
    mount({ threads: [{ id: "c1" }, { id: "c2" }], add: ["addButton"] });
    expect(pick(onDismiss, ctx({ replyingTo: "c1" }))).toBe("wait");
  });

  it("goes to the add box's first enabled control", () => {
    mount({ threads: [], add: ["addBody!", "addCancel", "addSubmit!"] });
    expect(pick(onDismiss)).toBe("addCancel");
  });

  it("waits while no control of the add box is enabled", () => {
    mount({ threads: [], add: ["addButton!"] });
    expect(pick(onDismiss)).toBe("wait");
  });
});
