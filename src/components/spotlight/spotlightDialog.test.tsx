/**
 * Tests for the shared spotlight dialog scaffolding — focus trap behavior
 * and icon rendering shared by QuickOpen and ContentSearch.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  handleSpotlightTabTrap,
  SpotlightFileIcon,
  SpotlightFolderIcon,
} from "./spotlightDialog";

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<input /><button>a</button><button>b</button>`;
  document.body.appendChild(el);
  return el;
}

describe("handleSpotlightTabTrap", () => {
  it("ignores non-Tab keys", () => {
    const container = makeContainer();
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Enter", shiftKey: false, preventDefault }, container);
    expect(preventDefault).not.toHaveBeenCalled();
    container.remove();
  });

  it("wraps Tab on last element to first", () => {
    const container = makeContainer();
    const last = container.querySelectorAll<HTMLElement>("input, button")[2];
    const first = container.querySelector<HTMLElement>("input")!;
    last.focus();
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Tab", shiftKey: false, preventDefault }, container);
    expect(preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
    container.remove();
  });

  it("wraps Shift+Tab on first element to last", () => {
    const container = makeContainer();
    const last = container.querySelectorAll<HTMLElement>("input, button")[2];
    const first = container.querySelector<HTMLElement>("input")!;
    first.focus();
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Tab", shiftKey: true, preventDefault }, container);
    expect(preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
    container.remove();
  });

  it("does not trap Tab in the middle", () => {
    const container = makeContainer();
    const middle = container.querySelectorAll<HTMLElement>("input, button")[1];
    middle.focus();
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Tab", shiftKey: false, preventDefault }, container);
    expect(preventDefault).not.toHaveBeenCalled();
    container.remove();
  });

  it("no-ops with a null container", () => {
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Tab", shiftKey: false, preventDefault }, null);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("no-ops with an empty container", () => {
    const empty = document.createElement("div");
    const preventDefault = vi.fn();
    handleSpotlightTabTrap({ key: "Tab", shiftKey: false, preventDefault }, empty);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("spotlight icons", () => {
  it("renders a file icon with the given class", () => {
    const { container } = render(<SpotlightFileIcon className="x-icon" />);
    expect(container.querySelector("svg.x-icon")).not.toBeNull();
  });

  it("renders a folder icon with the given class", () => {
    const { container } = render(<SpotlightFolderIcon className="y-icon" />);
    expect(container.querySelector("svg.y-icon")).not.toBeNull();
  });
});
