/**
 * Tests for sourcePeekHeader — getBlockTypeLabel and createEditHeader.
 */

import { describe, expect, it, vi } from "vitest";
import { getBlockTypeLabel, createEditHeader } from "./sourcePeekHeader";

// ---------------------------------------------------------------------------
// getBlockTypeLabel
// ---------------------------------------------------------------------------

describe("getBlockTypeLabel", () => {
  it("returns 'Paragraph' for paragraph", () => {
    expect(getBlockTypeLabel("paragraph")).toBe("Paragraph");
  });

  it("returns 'Heading' for heading", () => {
    expect(getBlockTypeLabel("heading")).toBe("Heading");
  });

  it("returns 'Code Block' for codeBlock", () => {
    expect(getBlockTypeLabel("codeBlock")).toBe("Code Block");
  });

  it("returns 'Code Block' for code_block (snake_case variant)", () => {
    expect(getBlockTypeLabel("code_block")).toBe("Code Block");
  });

  it("returns 'Blockquote' for blockquote", () => {
    expect(getBlockTypeLabel("blockquote")).toBe("Blockquote");
  });

  it("returns 'Bullet List' for bulletList", () => {
    expect(getBlockTypeLabel("bulletList")).toBe("Bullet List");
  });

  it("returns 'Numbered List' for orderedList", () => {
    expect(getBlockTypeLabel("orderedList")).toBe("Numbered List");
  });

  it("returns 'Task List' for taskList", () => {
    expect(getBlockTypeLabel("taskList")).toBe("Task List");
  });

  it("returns 'Table' for table", () => {
    expect(getBlockTypeLabel("table")).toBe("Table");
  });

  it("returns 'Details' for detailsBlock", () => {
    expect(getBlockTypeLabel("detailsBlock")).toBe("Details");
  });

  it("returns 'Divider' for horizontalRule", () => {
    expect(getBlockTypeLabel("horizontalRule")).toBe("Divider");
  });

  it("returns 'Image' for image", () => {
    expect(getBlockTypeLabel("image")).toBe("Image");
  });

  // Fallback: camelCase splitting
  it("falls back to camelCase splitting for unknown types", () => {
    expect(getBlockTypeLabel("myCustomBlock")).toBe("my Custom Block");
  });

  it("falls back correctly for single-word unknown type", () => {
    expect(getBlockTypeLabel("widget")).toBe("widget");
  });

  it("falls back for PascalCase unknown type", () => {
    expect(getBlockTypeLabel("AlertBlock")).toBe("Alert Block");
  });

  it("handles empty string", () => {
    expect(getBlockTypeLabel("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// createEditHeader
// ---------------------------------------------------------------------------

describe("createEditHeader", () => {
  const noop = () => {};

  it("returns an HTMLElement with correct class", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    expect(header).toBeInstanceOf(HTMLElement);
    expect(header.className).toBe("source-peek-inline-header");
  });

  it("adds 'has-changes' class when hasChanges is true", () => {
    const header = createEditHeader("paragraph", true, noop, noop, noop, false);
    expect(header.className).toContain("has-changes");
  });

  it("does not add 'has-changes' class when hasChanges is false", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    expect(header.className).not.toContain("has-changes");
  });

  it("contains title with 'Source Peek' text", () => {
    const header = createEditHeader("heading", false, noop, noop, noop, false);
    const title = header.querySelector(".source-peek-inline-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain("Source Peek");
  });

  it("contains block type label from getBlockTypeLabel", () => {
    const header = createEditHeader("bulletList", false, noop, noop, noop, false);
    const blockType = header.querySelector(".source-peek-inline-block-type");
    expect(blockType).not.toBeNull();
    expect(blockType!.textContent).toBe("Bullet List");
  });

  it("contains hint text with keyboard shortcuts", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const hint = header.querySelector(".source-peek-inline-hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("save");
    expect(hint!.textContent).toContain("cancel");
  });

  it("contains live preview button", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const liveBtn = header.querySelector(".source-peek-live-toggle");
    expect(liveBtn).not.toBeNull();
    expect(liveBtn!.getAttribute("title")).toBe("Toggle live preview");
  });

  it("live preview button has 'active' class when livePreview is true", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, true);
    const liveBtn = header.querySelector(".source-peek-live-toggle");
    expect(liveBtn!.classList.contains("active")).toBe(true);
  });

  it("live preview button does NOT have 'active' class when livePreview is false", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const liveBtn = header.querySelector(".source-peek-live-toggle");
    expect(liveBtn!.classList.contains("active")).toBe(false);
  });

  it("contains cancel button", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const cancelBtn = header.querySelector('[data-action="cancel"], .vm-icon-btn--danger');
    expect(cancelBtn).not.toBeNull();
    expect(cancelBtn!.getAttribute("title")).toContain("Cancel");
  });

  it("contains save button", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const saveBtn = header.querySelector('[data-action="save"], .vm-icon-btn--primary');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn!.getAttribute("title")).toContain("Save");
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    const header = createEditHeader("paragraph", false, onCancel, noop, noop, false);
    const cancelBtn = header.querySelector('[data-action="cancel"], .vm-icon-btn--danger') as HTMLButtonElement;
    cancelBtn.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSave when save button is clicked", () => {
    const onSave = vi.fn();
    const header = createEditHeader("paragraph", false, noop, onSave, noop, false);
    const saveBtn = header.querySelector('[data-action="save"], .vm-icon-btn--primary') as HTMLButtonElement;
    saveBtn.click();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("calls onToggleLive when live button is clicked", () => {
    const onToggleLive = vi.fn();
    const header = createEditHeader("paragraph", false, noop, noop, onToggleLive, false);
    const liveBtn = header.querySelector(".source-peek-live-toggle") as HTMLButtonElement;
    liveBtn.click();
    expect(onToggleLive).toHaveBeenCalledOnce();
  });

  it("toggles 'active' class on live button when clicked", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const liveBtn = header.querySelector(".source-peek-live-toggle") as HTMLButtonElement;
    expect(liveBtn.classList.contains("active")).toBe(false);
    liveBtn.click();
    expect(liveBtn.classList.contains("active")).toBe(true);
    liveBtn.click();
    expect(liveBtn.classList.contains("active")).toBe(false);
  });

  it("contains both eye icons in live button for CSS toggling", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const liveBtn = header.querySelector(".source-peek-live-toggle") as HTMLButtonElement;
    const eyeIcon = liveBtn.querySelector(".icon-eye");
    const eyeOffIcon = liveBtn.querySelector(".icon-eye-off");
    expect(eyeIcon).not.toBeNull();
    expect(eyeOffIcon).not.toBeNull();
  });

  it("mousedown on buttons calls preventDefault (prevents editor blur)", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const cancelBtn = header.querySelector('[data-action="cancel"], .vm-icon-btn--danger') as HTMLButtonElement;
    const mousedownEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const spy = vi.spyOn(mousedownEvent, "preventDefault");
    cancelBtn.dispatchEvent(mousedownEvent);
    expect(spy).toHaveBeenCalled();
  });

  it("actions container has correct class", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const actions = header.querySelector(".source-peek-inline-actions");
    expect(actions).not.toBeNull();
  });

  it("has correct DOM structure: title + actions as children of header", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    expect(header.children.length).toBe(2);
    expect(header.children[0].className).toBe("source-peek-inline-title");
    expect(header.children[1].className).toBe("source-peek-inline-actions");
  });

  it("actions contains 4 children: hint, live, cancel, save", () => {
    const header = createEditHeader("paragraph", false, noop, noop, noop, false);
    const actions = header.querySelector(".source-peek-inline-actions")!;
    expect(actions.children.length).toBe(4);
  });
});
