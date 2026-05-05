// ExpressionEditor — modal CodeMirror popup for if:/run: editing.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { ExpressionEditor } from "../ExpressionEditor";

afterEach(() => {
  cleanup();
});

describe("ExpressionEditor", () => {
  it("renders the title and seeds the editor with initialValue", () => {
    render(
      <ExpressionEditor
        initialValue="github.event_name == 'push'"
        language="yaml"
        title="Edit if"
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByLabelText("Edit if")).toBeDefined();
    // CodeMirror renders content inside the host element; the cm-editor
    // is the marker that mount succeeded.
    expect(document.querySelector(".cm-editor")).not.toBeNull();
  });

  it("calls onSave with the editor's current value when Save is clicked", () => {
    const onSave = vi.fn();
    render(
      <ExpressionEditor
        initialValue="orig"
        language="plain"
        title="Edit run"
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith("orig");
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ExpressionEditor
        initialValue=""
        language="plain"
        title="t"
        onSave={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ExpressionEditor
        initialValue=""
        language="plain"
        title="t"
        onSave={() => {}}
        onCancel={onCancel}
      />,
    );
    const backdrop = screen.getByRole("dialog");
    fireEvent.mouseDown(backdrop, { target: backdrop, currentTarget: backdrop });
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not cancel when clicking inside the modal body (target !== currentTarget)", () => {
    const onCancel = vi.fn();
    render(
      <ExpressionEditor
        initialValue=""
        language="plain"
        title="t"
        onSave={() => {}}
        onCancel={onCancel}
      />,
    );
    const inner = document.querySelector(".workflow-expression-editor")!;
    fireEvent.mouseDown(inner);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape on the dialog cancels", () => {
    const onCancel = vi.fn();
    render(
      <ExpressionEditor
        initialValue=""
        language="plain"
        title="t"
        onSave={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
