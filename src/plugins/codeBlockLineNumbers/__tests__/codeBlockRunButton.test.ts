// WI-4.3 — the "Run in Terminal" button on the REAL CodeBlockNodeView.
//
// The sibling CodeBlockNodeView.test.ts exercises a re-implementation of the
// class; this file drives the production one, because the thing under test is
// exactly "which fences get the button", and a copy of the class could answer
// that differently from the shipped one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";

const { mockRunInTerminal } = vi.hoisted(() => ({ mockRunInTerminal: vi.fn() }));

vi.mock("@/services/terminal/runInTerminal", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runInTerminal: mockRunInTerminal };
});

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

import { CodeBlockNodeView } from "../nodeView";

/** Minimal ProseMirror code-block node stand-in. */
const CODE_BLOCK_TYPE = { name: "codeBlock" };
function makeNode(language: string, text = "echo hi"): ProseMirrorNode {
  return {
    type: CODE_BLOCK_TYPE,
    attrs: { language },
    textContent: text,
  } as unknown as ProseMirrorNode;
}

function mountView(language: string, text = "echo hi") {
  const view = new CodeBlockNodeView(
    makeNode(language, text),
    {} as unknown as Editor,
    () => 0,
  );
  const runBtn = view.dom.querySelector<HTMLButtonElement>('.code-copy-btn[data-code-action="run"]');
  return { view, runBtn };
}

/** A button is offered when it exists AND is not display:none / hidden. */
function isOffered(btn: HTMLButtonElement | null): boolean {
  return !!btn && !btn.hidden && btn.style.display !== "none";
}

describe("code block run button (WI-4.3)", () => {
  beforeEach(() => {
    mockRunInTerminal.mockReset();
  });

  it.each(["bash", "sh", "zsh", "shell", "console"])(
    "is offered for a %s fence",
    (lang) => {
      const { runBtn } = mountView(lang);
      expect(isOffered(runBtn)).toBe(true);
    },
  );

  it.each(["", "javascript", "python", "json", "rust", "plaintext"])(
    "is NOT offered for a %j fence",
    (lang) => {
      const { runBtn } = mountView(lang);
      expect(isOffered(runBtn)).toBe(false);
    },
  );

  it("appears when the language is changed to a shell one", () => {
    const { view, runBtn } = mountView("python");
    expect(isOffered(runBtn)).toBe(false);

    view.update(makeNode("bash"));
    expect(isOffered(view.dom.querySelector('.code-copy-btn[data-code-action="run"]'))).toBe(true);
  });

  it("disappears when the language is changed away from a shell one", () => {
    const { view } = mountView("bash");
    expect(isOffered(view.dom.querySelector('.code-copy-btn[data-code-action="run"]'))).toBe(true);

    view.update(makeNode("json"));
    expect(isOffered(view.dom.querySelector('.code-copy-btn[data-code-action="run"]'))).toBe(false);
  });

  it("sends the block's text and language on click", () => {
    const { runBtn } = mountView("bash", "make build\nmake test");
    runBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mockRunInTerminal).toHaveBeenCalledWith("make build\nmake test", "bash");
  });

  it("sends the CURRENT text after an update, not the mounted text", () => {
    const { view } = mountView("bash", "old");
    view.update(makeNode("bash", "new"));
    view.dom
      .querySelector<HTMLButtonElement>('.code-copy-btn[data-code-action="run"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mockRunInTerminal).toHaveBeenCalledWith("new", "bash");
  });

  it("carries an accessible name", () => {
    const { runBtn } = mountView("bash");
    expect(runBtn!.getAttribute("aria-label")).toBeTruthy();
    expect(runBtn!.title).toBe(runBtn!.getAttribute("aria-label"));
  });

  it("does not let the click reach ProseMirror as a selection change", () => {
    const { view, runBtn } = mountView("bash");
    const onClick = vi.fn();
    view.dom.addEventListener("click", onClick);
    runBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    // stopPropagation on the button keeps the wrapper (and PM) out of it.
    expect(onClick).not.toHaveBeenCalled();
  });

  it("unregisters its listeners on destroy", () => {
    const { view, runBtn } = mountView("bash");
    view.destroy();
    runBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(mockRunInTerminal).not.toHaveBeenCalled();
  });
});
