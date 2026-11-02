/**
 * App chrome must not take a text selection, and everything a user types in or
 * reads to copy must keep it (real engine).
 *
 * jsdom has no selection engine and no user-select inheritance, and WebKit is
 * the one engine that needs the prefixed property, so this is the only tier
 * that can see either half. Premises are read from the engine's own computed
 * style and from a real `document.execCommand("selectAll")`, which is the same
 * WebCore path as the macOS Edit menu's Select All.
 */
import "@/styles/index.css";
import "@/styles/chrome-selection.css";
import { afterEach, describe, expect, it } from "vitest";
import { installPageSelectAllGuard } from "@/services/commands/pageSelectAllGuard";
import { allowBodyTextSelection, suppressBodyTextSelection } from "@/utils/bodyTextSelection";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

const userSelect = (el: Element): string =>
  (getComputedStyle(el) as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect;

function selectedText(): string {
  return (getSelection()?.toString() ?? "").replace(/\s+/g, " ").trim();
}

describe("chrome text selection (WebKit)", () => {
  afterEach(() => {
    getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    allowBodyTextSelection();
  });

  it.each([
    ["a button", `<button id="t">Save</button>`],
    ["a menu item", `<div role="menu"><div id="t" role="menuitemradio">Paragraph</div></div>`],
    ["a tree row", `<div id="t" role="treeitem">Heading</div>`],
    ["a listbox option", `<div id="t" role="option">Result</div>`],
    ["a tab", `<div id="t" role="tab">Doc</div>`],
    ["a form label", `<label id="t">Theme</label>`],
    ["a sidebar title", `<div class="sidebar"><span id="t">OUTLINE</span></div>`],
    ["a rail glyph", `<div class="workspace-rail"><span id="t">U</span></div>`],
    ["a status bar item", `<div class="status-bar"><span id="t">error</span></div>`],
    ["a picker hint", `<div class="genie-picker"><span id="t">cycle scope</span></div>`],
    ["an overlay footer", `<div class="vm-overlay__footer"><span id="t">navigate</span></div>`],
    ["a panel header", `<div class="vm-panel__header"><span id="t">Title</span></div>`],
    ["the welcome screen", `<div class="welcome-screen"><h1 id="t">VMark</h1></div>`],
    ["a word count label", `<dt id="t" class="word-count-popover__label">Words</dt>`],
  ])("refuses a selection on %s", (_name, html) => {
    mount(html);
    expect(userSelect(document.getElementById("t") as Element)).toBe("none");
  });

  it("keeps text fields selectable inside non-selectable chrome", () => {
    const host = mount(`
      <div class="sidebar"><label>Filter <input id="i" value="abc"></label></div>
      <div class="genie-picker"><textarea id="ta">abc</textarea></div>`);
    expect(userSelect(host.querySelector("#i") as Element)).toBe("text");
    expect(userSelect(host.querySelector("#ta") as Element)).toBe("text");
    const input = host.querySelector("#i") as HTMLInputElement;
    input.focus();
    input.select();
    expect(input.selectionEnd).toBe(3);
  });

  it("keeps the document's own labels and buttons editable", () => {
    const host = mount(`
      <div class="ProseMirror" contenteditable="true">
        <details><summary id="s">Title</summary></details>
        <label id="l">Task</label>
      </div>
      <div class="cm-editor"><label id="c">x</label></div>`);
    for (const id of ["s", "l", "c"]) {
      expect(userSelect(host.querySelector(`#${id}`) as Element)).not.toBe("none");
    }
  });

  it.each([
    ["a word count value", `<div class="word-count-popover__value" id="t">123</div>`],
    ["an approval dialog body", `<div class="vm-overlay__panel"><p id="t">Runs rm</p></div>`],
    [
      "a genie response",
      `<div class="genie-picker"><div class="genie-response-view"><p id="t">Answer</p></div></div>`,
    ],
    ["plain read-only text", `<p id="t">Body</p>`],
  ])("leaves %s selectable", (_name, html) => {
    mount(html);
    expect(userSelect(document.getElementById("t") as Element)).not.toBe("none");
  });

  it("keeps a genie response's buttons out of the selection", () => {
    mount(`<div class="genie-picker"><div class="genie-response-view">
      <button id="t">Accept</button></div></div>`);
    expect(userSelect(document.getElementById("t") as Element)).toBe("none");
  });

  it("a body drag lock really stops selection in this engine", () => {
    const host = mount(`<p id="t">Body</p>`);
    suppressBodyTextSelection();
    expect(userSelect(host.querySelector("#t") as Element)).toBe("none");
    allowBodyTextSelection();
    expect(userSelect(host.querySelector("#t") as Element)).not.toBe("none");
  });

  describe("page-wide Select All", () => {
    it("selects read-only text without the guard (the premise)", () => {
      mount(`<p>Body text</p>`);
      document.execCommand("selectAll");
      expect(selectedText()).toContain("Body text");
    });

    it("selects nothing with the guard when focus is outside any field", () => {
      const uninstall = installPageSelectAllGuard();
      try {
        mount(`<p>Body text</p>`);
        document.execCommand("selectAll");
        expect(selectedText()).toBe("");
      } finally {
        uninstall();
      }
    });

    it("still selects the editable surface holding focus", () => {
      const uninstall = installPageSelectAllGuard();
      try {
        const host = mount(`<p>Outside</p><div id="e" contenteditable="true">Inside</div>`);
        (host.querySelector("#e") as HTMLElement).focus();
        document.execCommand("selectAll");
        expect(selectedText()).toBe("Inside");
      } finally {
        uninstall();
      }
    });

    it("still selects the text field holding focus", () => {
      const uninstall = installPageSelectAllGuard();
      try {
        const host = mount(`<p>Outside</p><input id="i" value="abc">`);
        const input = host.querySelector("#i") as HTMLInputElement;
        input.focus();
        document.execCommand("selectAll");
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(3);
      } finally {
        uninstall();
      }
    });
  });
});
