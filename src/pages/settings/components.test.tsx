/**
 * TagInput IME Guard Tests
 *
 * Verifies that IME composition events are blocked from
 * triggering tag creation in the TagInput component.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TagInput } from "./components";

describe("TagInput — IME composition guard", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    onChange.mockClear();
  });

  it("Enter with isComposing does not add a tag", () => {
    render(<TagInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add item...");

    fireEvent.change(input, { target: { value: "custom" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("comma with isComposing does not add a tag", () => {
    render(<TagInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add item...");

    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: ",", isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keyCode 229 (IME marker) is blocked", () => {
    render(<TagInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add item...");

    fireEvent.change(input, { target: { value: "proto" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter within grace period after compositionEnd is blocked", () => {
    render(<TagInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add item...");

    fireEvent.change(input, { target: { value: "custom" } });
    // Simulate composition then immediate Enter (macOS WebKit pattern)
    fireEvent.compositionStart(input);
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("normal Enter still adds a tag", () => {
    render(<TagInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("Add item...");

    fireEvent.change(input, { target: { value: "custom" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith(["custom"]);
  });
});
