/**
 * An outline click in one window must not scroll another window (#1672).
 *
 * `OutlineView` answers a click with `emitTo(<this window>, "outline:scroll-to-heading")`.
 * That only stays in one window if every listener is registered FOR that window:
 * Tauri delivers an addressed event to a listener when the listener's target is
 * `Any` OR matches the address (`tauri-2.x/src/event/listener.rs`,
 * `match_any_or_filter`), and it walks every webview's listeners. A listener
 * registered with no `target` is `Any`, so it is woken by every window's click.
 *
 * The bus below implements that rule, so the test fails for the reason the bug
 * happens, not for the shape of one call. Two windows are mounted, the click is
 * addressed to window A, and window B's editor must stay untouched.
 *
 * @module hooks/outlineSync.windowScope.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

type Target = { kind: "Any" } | { kind: "AnyLabel" | "WebviewWindow" | "Window" | "Webview"; label: string };
type Handler = (event: { payload: unknown }) => void;
interface Registered {
  event: string;
  target: Target;
  handler: Handler;
}

const bus = vi.hoisted(() => ({ listeners: [] as Registered[] }));

/** `listen` as `@tauri-apps/api/event` registers it: no `target` means `Any`. */
function fakeListen(event: string, handler: Handler, options?: { target?: string | Target }) {
  const raw = options?.target;
  const target: Target =
    typeof raw === "string" ? { kind: "AnyLabel", label: raw } : (raw ?? { kind: "Any" });
  bus.listeners.push({ event, target, handler });
  return Promise.resolve(() => {});
}

/** `emitTo(label, …)` → `EventTarget::AnyLabel`, filtered exactly as `manager/mod.rs` does. */
function fakeEmitTo(label: string, event: string, payload: unknown) {
  for (const l of bus.listeners) {
    if (l.event !== event) continue;
    const matches =
      l.target.kind === "Any" ||
      ((l.target.kind === "AnyLabel" ||
        l.target.kind === "WebviewWindow" ||
        l.target.kind === "Window" ||
        l.target.kind === "Webview") &&
        l.target.label === label);
    if (matches) l.handler({ payload });
  }
  return Promise.resolve();
}

vi.mock("@tauri-apps/api/event", () => ({ listen: fakeListen, emitTo: fakeEmitTo }));
vi.mock("@/utils/safeUnlisten", () => ({ safeUnlisten: vi.fn() }));
vi.mock("@tiptap/pm/state", () => ({ Selection: { near: (pos: unknown) => ({ anchor: pos }) } }));
vi.mock("@/services/editor/tiptapView", () => ({ getTiptapEditorDom: () => null }));

import { setCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { useOutlineSync } from "./useOutlineSync";
import { useSourceOutlineSync } from "./useSourceOutlineSync";

const EVENT = "outline:scroll-to-heading";

/** A ProseMirror-shaped view with one heading at position 0. */
function proseView() {
  return {
    state: {
      doc: {
        descendants: (cb: (n: { type: { name: string } }, pos: number) => boolean | undefined) => {
          cb({ type: { name: "heading" } }, 0);
        },
        resolve: (pos: number) => pos,
      },
      tr: { setSelection: vi.fn().mockReturnThis(), setMeta: vi.fn().mockReturnThis() },
      selection: { anchor: 0 },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    nodeDOM: vi.fn(() => null),
  };
}

/** A CodeMirror-shaped view over a one-heading document. */
function sourceView() {
  const text = "# Title\n";
  return {
    state: {
      doc: {
        lines: 1,
        length: text.length,
        line: () => ({ text: "# Title", from: 0, to: 7, number: 1 }),
        lineAt: () => ({ text: "# Title", from: 0, to: 7, number: 1 }),
        toString: () => text,
        sliceString: () => text,
      },
      selection: { main: { head: 0 } },
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    dom: document.createElement("div"),
  };
}

/** Mount `mount` as window `label`, the way that window's own webview would. */
function inWindow(label: string, mount: () => void) {
  setCurrentWindowLabel(label);
  mount();
}

describe("outline click stays in the window it was made in (#1672)", () => {
  beforeEach(() => {
    bus.listeners.length = 0;
    setCurrentWindowLabel("main");
  });

  it("WYSIWYG: a click addressed to window A does not move window B's editor", async () => {
    const a = proseView();
    const b = proseView();
    inWindow("doc-a", () => renderHook(() => useOutlineSync(() => a as never)));
    inWindow("doc-b", () => renderHook(() => useOutlineSync(() => b as never)));
    await vi.waitFor(() => expect(bus.listeners.filter((l) => l.event === EVENT)).toHaveLength(2));

    await fakeEmitTo("doc-a", EVENT, { headingIndex: 0 });

    expect(a.dispatch).toHaveBeenCalledTimes(1);
    expect(b.dispatch).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("Source mode: a click addressed to window A does not move window B's editor", async () => {
    const a = sourceView();
    const b = sourceView();
    inWindow("doc-a", () => renderHook(() => useSourceOutlineSync({ current: a } as never, false)));
    inWindow("doc-b", () => renderHook(() => useSourceOutlineSync({ current: b } as never, false)));
    await vi.waitFor(() => expect(bus.listeners.filter((l) => l.event === EVENT)).toHaveLength(2));

    await fakeEmitTo("doc-a", EVENT, { headingIndex: 0 });

    expect(a.dispatch).toHaveBeenCalledTimes(1);
    expect(b.dispatch).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
  });

  it("the window that was clicked still answers (the fix must not silence it)", async () => {
    const only = proseView();
    inWindow("doc-a", () => renderHook(() => useOutlineSync(() => only as never)));
    await vi.waitFor(() => expect(bus.listeners.filter((l) => l.event === EVENT)).toHaveLength(1));

    await fakeEmitTo("doc-a", EVENT, { headingIndex: 0 });

    expect(only.dispatch).toHaveBeenCalledTimes(1);
    expect(only.focus).toHaveBeenCalledTimes(1);
  });
});
