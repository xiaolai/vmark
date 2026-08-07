// @vitest-environment node
/**
 * The footnote extension's store option.
 *
 * A port has no default (there is no stand-in for "the state this popup
 * drives"), so a host that omits it must be told at wiring time rather than
 * crashing inside the DOM code.
 *
 * @coordinates-with plugins/footnotePopup/tiptap.ts
 * @module plugins/footnotePopup/tiptapOptions.test
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./footnote-popup.css", () => ({}));
vi.mock("./FootnotePopupView", () => ({
  FootnotePopupView: class {
    update() {}
    destroy() {}
  },
}));

import { footnotePopupExtension } from "./tiptap";

function build(store: unknown) {
  return footnotePopupExtension.config.addProseMirrorPlugins!.call({
    name: "footnotePopup",
    options: { store },
    storage: {},
    parent: null as never,
    editor: {} as never,
    type: "extension" as never,
  } as never);
}

describe("the store option", () => {
  it("tells a host that forgot it, by name", () => {
    expect(() => build(undefined)).toThrow(/requires a `store` option/);
  });

  it("builds the plugin when supplied", () => {
    const store = { getState: () => ({ isOpen: false }), subscribe: () => () => {} };
    expect(build(store)).toHaveLength(1);
  });

  it("has no default — a port is not a setting", () => {
    // Settings default to something sensible; "the state this popup drives"
    // has no stand-in, so the default is deliberately undefined.
    const opts = footnotePopupExtension.config.addOptions!.call({} as never) as {
      store: unknown;
    };
    expect(opts.store).toBeUndefined();
  });
});
