/**
 * The math-popup extension's wiring.
 *
 * The store arrives as an injected PORT rather than an import (ADR-015), so
 * this asserts the extension actually threads it to the view — the failure
 * that injection makes possible is passing the option and never using it.
 *
 * @coordinates-with plugins/mathPopup/tiptap.ts
 * @module plugins/mathPopup/tiptap.test
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./math-popup.css", () => ({}));

const constructed: unknown[] = [];
vi.mock("./MathPopupView", () => ({
  MathPopupView: class {
    constructor(_view: unknown, store: unknown) {
      constructed.push(store);
    }
    destroy() {}
  },
}));

import { mathPopupExtension } from "./tiptap";

function pluginFor(store: unknown) {
  const plugins = mathPopupExtension.config.addProseMirrorPlugins!.call({
    name: "mathPopup",
    options: { store },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  } as never) as { spec: { view?: (v: unknown) => { destroy(): void } } }[];
  return plugins[0];
}

describe("the injected store reaches the view", () => {
  it("passes the option through, not a store it imported", () => {
    const store = { getState: () => ({}), subscribe: () => () => {} };
    const plugin = pluginFor(store);
    plugin.spec.view!({} as never);
    expect(constructed.at(-1)).toBe(store);
  });

  it("destroys the view with the editor", () => {
    const store = { getState: () => ({}), subscribe: () => () => {} };
    const handle = pluginFor(store).spec.view!({} as never);
    expect(() => handle.destroy()).not.toThrow();
  });
});

describe("a host that forgets the store is told so", () => {
  it("throws a NAMED error rather than crashing inside the view", () => {
    // There is no sensible default for "the state this popup drives", unlike a
    // setting. Failing loud at wiring time beats an undefined-property error
    // from somewhere in the DOM code.
    expect(() => pluginFor(undefined)).toThrow(/requires a `store` option/);
  });
});
