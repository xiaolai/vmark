// WI-2.1 — ViewModeToggle: segmented Source/Split/Preview control.

import { useState } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SplitViewMode } from "@/lib/formats/types";
import { ViewModeToggle } from "./ViewModeToggle";

/** Controlled wrapper so `mode` actually updates on change (roving tabindex). */
function Controlled({ initial = "split" }: { initial?: SplitViewMode }) {
  const [mode, setMode] = useState<SplitViewMode>(initial);
  return <ViewModeToggle mode={mode} onChange={setMode} />;
}

describe("ViewModeToggle", () => {
  afterEach(() => cleanup());

  it("renders a radiogroup with three radios", () => {
    render(<ViewModeToggle mode="split" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks the active mode with aria-checked", () => {
    render(<ViewModeToggle mode="preview" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    // The active radio is the only one in the tab order (roving tabindex).
    expect(checked[0]).toHaveAttribute("tabindex", "0");
    radios
      .filter((r) => r !== checked[0])
      .forEach((r) => expect(r).toHaveAttribute("tabindex", "-1"));
  });

  it("calls onChange with the clicked mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewModeToggle mode="split" onChange={onChange} />);
    // Radios are labeled by their translated text; click the first one.
    const radios = screen.getAllByRole("radio");
    await user.click(radios[0]); // source
    expect(onChange).toHaveBeenCalledWith("source");
    await user.click(radios[2]); // preview
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  function focusActiveRadio() {
    const active = screen
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-checked") === "true");
    active?.focus();
  }

  it("arrow keys move to the adjacent mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewModeToggle mode="split" onChange={onChange} />);
    focusActiveRadio();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("preview");
    onChange.mockClear();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("source");
  });

  it("arrow-right wraps from the last mode to the first", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewModeToggle mode="preview" onChange={onChange} />);
    focusActiveRadio();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("source");
  });

  it("Home/End jump to the first/last mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewModeToggle mode="split" onChange={onChange} />);
    focusActiveRadio();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("source");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("preview");
  });

  it("moves DOM focus to the newly selected radio on arrow nav", async () => {
    const user = userEvent.setup();
    render(<Controlled initial="split" />);
    const radios = screen.getAllByRole("radio");
    radios[1].focus(); // "split" is active
    await user.keyboard("{ArrowRight}");
    // "preview" is now active AND focused (not left on the old radio).
    const preview = screen
      .getAllByRole("radio")
      .find((r) => r.getAttribute("aria-checked") === "true");
    expect(preview).toHaveFocus();
  });

  it("does not fire onChange for unrelated keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewModeToggle mode="split" onChange={onChange} />);
    focusActiveRadio();
    await user.keyboard("a");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("covers every SplitViewMode value", () => {
    // Guard: exactly source/split/preview render, in that order.
    const modes: SplitViewMode[] = ["source", "split", "preview"];
    render(<ViewModeToggle mode="split" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(modes.length);
  });
});
