// @vitest-environment node
/**
 * The link-create popup extension's wiring.
 *
 * The store arrives as an injected PORT (ADR-015), so this asserts the
 * extension threads it to the view, and that a host which forgets is told so
 * at wiring time rather than crashing inside the DOM code.
 *
 * @coordinates-with plugins/linkCreatePopup/tiptap.ts
 * @module plugins/linkCreatePopup/tiptap.test
 */
import { describe, it, expect, vi } from "vitest";

const constructed: unknown[] = [];
vi.mock("./LinkCreatePopupView", () => ({
  LinkCreatePopupView: class {
    constructor(_view: unknown, store: unknown) {
      constructed.push(store);
    }
    destroy() {}
  },
}));

import { linkCreatePopupExtension } from "./tiptap";

function pluginFor(store: unknown) {
  const plugins = linkCreatePopupExtension.config.addProseMirrorPlugins!.call({
    name: "linkCreatePopup",
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
    pluginFor(store).spec.view!({} as never);
    expect(constructed.at(-1)).toBe(store);
  });

  it("destroys the view with the editor", () => {
    const store = { getState: () => ({}), subscribe: () => () => {} };
    const handle = pluginFor(store).spec.view!({} as never);
    expect(() => handle.destroy()).not.toThrow();
  });

  it("tells a host that forgot the store, by name", () => {
    expect(() => pluginFor(undefined)).toThrow(/requires a `store` option/);
  });
});
