/**
 * resolveBindingContext — active scope stack. Covers the audit fix: editor scope
 * is chosen by the FOCUSED surface (.cm-editor → source, .ProseMirror → wysiwyg),
 * not the global sourceMode flag, so a split view scopes to the pane the user is
 * actually in.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resolveBindingContext } from "./bindingContext";

function focusInside(html: string): void {
  document.body.innerHTML = html;
  (document.querySelector("[data-focus]") as HTMLElement | null)?.focus();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveBindingContext — editor surface scoping", () => {
  it("focus in a CodeMirror surface → editor-source", () => {
    focusInside(`<div class="cm-editor"><span data-focus tabindex="0"></span></div>`);
    const ctx = resolveBindingContext("main");
    expect(ctx.activeScopes).toContain("editor-source");
    expect(ctx.activeScopes).not.toContain("editor-wysiwyg");
  });

  it("focus in a ProseMirror surface → editor-wysiwyg", () => {
    focusInside(`<div class="ProseMirror"><span data-focus tabindex="0"></span></div>`);
    const ctx = resolveBindingContext("main");
    expect(ctx.activeScopes).toContain("editor-wysiwyg");
    expect(ctx.activeScopes).not.toContain("editor-source");
  });

  it("split view (both mounted), Source pane focused → editor-source", () => {
    focusInside(
      `<div class="ProseMirror"></div><div class="cm-editor"><span data-focus tabindex="0"></span></div>`,
    );
    expect(resolveBindingContext("main").activeScopes).toContain("editor-source");
  });

  it("terminal focus outranks editor detection", () => {
    focusInside(`<div class="terminal-container"><span data-focus tabindex="0"></span></div>`);
    const ctx = resolveBindingContext("main");
    expect(ctx.activeScopes).toContain("terminal");
    expect(ctx.activeScopes).not.toContain("editor-source");
  });

  it("plain input → input scope; window is always present; windowLabel carried", () => {
    document.body.innerHTML = `<input data-focus />`;
    (document.querySelector("[data-focus]") as HTMLElement).focus();
    const ctx = resolveBindingContext("doc-2");
    expect(ctx.activeScopes).toContain("window");
    expect(ctx.activeScopes).toContain("input");
    expect(ctx.windowLabel).toBe("doc-2");
  });
});
