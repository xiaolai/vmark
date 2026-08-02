/**
 * The host-editors seam.
 *
 * @coordinates-with plugins/shared/hostEditors.ts
 * @module plugins/shared/hostEditors.test
 */
import { describe, it, expect, afterEach } from "vitest";
import { hostEditors, bindHostEditors, resetHostEditors } from "./hostEditors";

afterEach(resetHostEditors);

describe("the unbound defaults report no editor mounted", () => {
  it("returns a null view for both surfaces rather than throwing", () => {
    // Every caller already guards on a null view — a toolbar click before the
    // editor mounts is a real case — so this yields a toolbar that accepts no
    // action rather than one that crashes.
    expect(hostEditors.source().editorView).toBeNull();
    expect(hostEditors.wysiwyg().editorView).toBeNull();
  });
});

describe("binding", () => {
  it("routes each surface to its own binding", () => {
    const source = { editorView: { cm: true }, context: { line: 1 } };
    const wysiwyg = { editorView: { pm: true }, editor: { tiptap: true } };
    bindHostEditors({ source: () => source, wysiwyg: () => wysiwyg });
    expect(hostEditors.source()).toBe(source);
    expect(hostEditors.wysiwyg()).toBe(wysiwyg);
  });

  it("reads FRESH on every call, so a remount is not captured stale", () => {
    let view: unknown = { first: true };
    bindHostEditors({ wysiwyg: () => ({ editorView: view }) });
    expect(hostEditors.wysiwyg().editorView).toEqual({ first: true });
    view = { second: true };
    expect(hostEditors.wysiwyg().editorView).toEqual({ second: true });
  });

  it("rebinding replaces rather than merges, and the unset half falls back", () => {
    bindHostEditors({ source: () => ({ editorView: { cm: true } }) });
    // `wysiwyg` was never bound, so it is the default, not a leftover.
    expect(hostEditors.wysiwyg().editorView).toBeNull();
    bindHostEditors({});
    expect(hostEditors.source().editorView).toBeNull();
  });
});
