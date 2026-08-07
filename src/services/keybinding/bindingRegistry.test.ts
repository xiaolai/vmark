// @vitest-environment node
// WI-1.2/1.3 — the binding registry: resolution, precedence, referential integrity.
import { describe, it, expect, vi } from "vitest";
import {
  resolveBinding,
  buildIndex,
  AmbiguousBindingError,
  type Binding,
  type BindingContext,
  type BindingIndex,
} from "./bindingRegistry";

function cmd(over: Partial<Binding> = {}): Binding {
  return {
    kind: "command",
    commandId: "test.cmd",
    fixedChord: "meta+KeyK",
    scope: "window",
    priority: 0,
    captureOwner: "window",
    repeat: "deny",
    ime: "block",
    consumption: "preventDefault",
    ...over,
  } as Binding;
}

function ctx(activeScopes: BindingContext["activeScopes"], extra: Record<string, unknown> = {}): BindingContext {
  return { activeScopes, ...extra };
}

function indexOf(...bindings: Binding[]): BindingIndex {
  return buildIndex(bindings, () => null); // all use fixedChord
}

describe("resolveBinding", () => {
  it("returns null when nothing is registered / no active scope / wrong owner", () => {
    const idx = indexOf(cmd());
    expect(resolveBinding(idx, "meta+KeyZ", ctx(["window"]), "window")).toBeNull();
    expect(resolveBinding(idx, "meta+KeyK", ctx(["panel"]), "window")).toBeNull(); // scope inactive
    expect(resolveBinding(idx, "meta+KeyK", ctx(["window"]), "prosemirror")).toBeNull(); // wrong owner
  });

  it("resolves an eligible binding", () => {
    const idx = indexOf(cmd({ commandId: "a" }));
    const r = resolveBinding(idx, "meta+KeyK", ctx(["window"]), "window");
    expect(r?.binding.kind === "command" && r.binding.commandId).toBe("a");
  });

  it("honors when(ctx)", () => {
    const idx = indexOf(cmd({ when: (c) => c.enabled === true }));
    expect(resolveBinding(idx, "meta+KeyK", ctx(["window"], { enabled: false }), "window")).toBeNull();
    expect(
      resolveBinding(idx, "meta+KeyK", ctx(["window"], { enabled: true }), "window")?.binding,
    ).toBeDefined();
  });

  it("a throwing when() disables only its own binding", () => {
    const boom = cmd({ commandId: "boom", when: () => { throw new Error("x"); } });
    const ok = cmd({ commandId: "ok", scope: "panel", priority: 5 });
    const idx = indexOf(boom, ok);
    const r = resolveBinding(idx, "meta+KeyK", ctx(["window", "panel"]), "window");
    expect(r?.binding.kind === "command" && r.binding.commandId).toBe("ok");
  });

  it("higher scope-specificity wins over declared priority", () => {
    // editor-source (40) beats window (10) even with lower priority.
    const editor = cmd({ commandId: "editor", scope: "editor-source", priority: 0, captureOwner: "codemirror" });
    const win = cmd({ commandId: "win", scope: "window", priority: 100 });
    const idx = indexOf(editor, win);
    // The window adapter only sees window-owned; the CM adapter sees editor-owned.
    expect(resolveBinding(idx, "meta+KeyK", ctx(["editor-source", "window"]), "window")?.binding).toMatchObject({ commandId: "win" });
    expect(resolveBinding(idx, "meta+KeyK", ctx(["editor-source", "window"]), "codemirror")?.binding).toMatchObject({ commandId: "editor" });
  });

  it("input does NOT out-rank an editor (both contenteditable)", () => {
    const editor = cmd({ commandId: "editor", scope: "editor-wysiwyg", captureOwner: "window" });
    const input = cmd({ commandId: "input", scope: "input", captureOwner: "window" });
    const idx = indexOf(editor, input);
    const r = resolveBinding(idx, "meta+KeyK", ctx(["editor-wysiwyg", "input", "window"]), "window");
    expect(r?.binding).toMatchObject({ commandId: "editor" }); // editor(40) > input(30)
  });

  it("same scope → higher priority wins", () => {
    const lo = cmd({ commandId: "lo", priority: 1 });
    const hi = cmd({ commandId: "hi", priority: 2 });
    const idx = indexOf(lo, hi);
    expect(resolveBinding(idx, "meta+KeyK", ctx(["window"]), "window")?.binding).toMatchObject({ commandId: "hi" });
  });

  it("an exact specificity+priority tie throws AmbiguousBindingError (not first-wins)", () => {
    const a = cmd({ commandId: "a", priority: 3 });
    const b = cmd({ commandId: "b", priority: 3 });
    const idx = indexOf(a, b);
    expect(() => resolveBinding(idx, "meta+KeyK", ctx(["window"]), "window")).toThrow(AmbiguousBindingError);
  });

  it("cross-scope coexistence of the same chord is fine (no throw)", () => {
    const win = cmd({ commandId: "win", scope: "window" });
    const panel = cmd({ commandId: "panel", scope: "panel" });
    const idx = indexOf(win, panel);
    // Only window active → window wins, no ambiguity.
    expect(resolveBinding(idx, "meta+KeyK", ctx(["window"]), "window")?.binding).toMatchObject({ commandId: "win" });
  });
});

describe("buildIndex — referential integrity (WI-1.3)", () => {
  it("drops a binding whose shortcutId can't be resolved, reporting it", () => {
    const dropped = vi.fn();
    const base = {
      kind: "command" as const,
      scope: "window" as const,
      priority: 0,
      captureOwner: "window" as const,
      repeat: "deny" as const,
      ime: "block" as const,
      consumption: "preventDefault" as const,
    };
    const bound: Binding = { ...base, commandId: "bound", shortcutId: "known" };
    const unbound: Binding = { ...base, commandId: "unbound", shortcutId: "missing" };
    const idx = buildIndex([bound, unbound], (id) => (id === "known" ? "meta+KeyB" : null), dropped);
    expect(idx.get("meta+KeyB")).toHaveLength(1);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(dropped.mock.calls[0][1]).toContain("missing");
  });

  it("fixedChord bindings enter the index directly", () => {
    const idx = buildIndex([cmd({ fixedChord: "ctrl+KeyA" })], () => null);
    expect(idx.get("ctrl+KeyA")).toHaveLength(1);
  });

  it("multiple bindings on one chord share a bucket (ordered candidate list)", () => {
    const idx = indexOf(cmd({ commandId: "a" }), cmd({ commandId: "b", scope: "panel" }));
    expect(idx.get("meta+KeyK")).toHaveLength(2);
  });
});
