// Behavior tests for the shortcut-capture modal: chord capture, Escape
// cancel, unmappable-chord refusal, and the shared modal shell (audit round
// 2, finding 27 — the backdrop is `.vm-overlay--center`, whose scrim marks
// modality; a bespoke hover-tint backdrop was invisible in dark themes).
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { KeyCapture } from "./KeyCapture";
import type { ShortcutDefinition } from "@/stores/settingsStore";

const shortcut: ShortcutDefinition = {
  id: "sourceMode",
  label: "Toggle Source Mode",
  category: "view",
  defaultKey: "Mod-/",
} as ShortcutDefinition;

function renderCapture(overrides: Partial<Parameters<typeof KeyCapture>[0]> = {}) {
  const onCapture = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <KeyCapture shortcut={shortcut} conflict={null} onCapture={onCapture} onCancel={onCancel} {...overrides} />,
  );
  return { onCapture, onCancel, ...utils };
}

describe("KeyCapture", () => {
  it("mounts on the shared modal shell (vm-overlay--center owns the scrim)", () => {
    const { container } = renderCapture();
    const backdrop = container.firstElementChild;
    expect(backdrop?.className).toContain("vm-overlay");
    expect(backdrop?.className).toContain("vm-overlay--center");
  });

  it("captures a chord and confirms it through onCapture", () => {
    const { onCapture } = renderCapture();
    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true });
    const confirm = screen.getByRole("button", { name: /assign|confirm|ok|save/i });
    fireEvent.click(confirm);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0]).toMatch(/k$/i);
  });

  it("Escape cancels without capturing", () => {
    const { onCapture, onCancel } = renderCapture();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("a lone modifier is not captured", () => {
    const { onCapture } = renderCapture();
    fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
    const confirm = screen.getByRole("button", { name: /assign|confirm|ok|save/i });
    fireEvent.click(confirm);
    // Nothing captured yet, so confirming assigns nothing.
    expect(onCapture).not.toHaveBeenCalled();
  });
});
