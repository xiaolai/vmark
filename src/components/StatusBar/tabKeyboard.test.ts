import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleTabKeyboard } from "./tabKeyboard";

function createKeyboardEvent(overrides: Partial<ReactKeyboardEvent> & { key: string }): ReactKeyboardEvent {
  const { key, ...rest } = overrides;
  return {
    key,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
    ...rest,
  } as unknown as ReactKeyboardEvent;
}

describe("handleTabKeyboard", () => {
  it("reorders left with Alt+Shift+ArrowLeft", () => {
    const onReorder = vi.fn();
    const onActivate = vi.fn();
    const event = createKeyboardEvent({ key: "ArrowLeft", altKey: true, shiftKey: true });

    handleTabKeyboard({
      tabId: "tab-2",
      event,
      tabs: [
        { id: "tab-1", filePath: null, title: "One", isPinned: false },
        { id: "tab-2", filePath: null, title: "Two", isPinned: false },
      ],
      onReorder,
      onActivate,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith("tab-2", 1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("reorders right with Alt+Shift+ArrowRight", () => {
    const onReorder = vi.fn();
    const event = createKeyboardEvent({ key: "ArrowRight", altKey: true, shiftKey: true });

    handleTabKeyboard({
      tabId: "tab-2",
      event,
      tabs: [
        { id: "tab-1", filePath: null, title: "One", isPinned: false },
        { id: "tab-2", filePath: null, title: "Two", isPinned: false },
      ],
      onReorder,
      onActivate: vi.fn(),
    });

    expect(onReorder).toHaveBeenCalledWith("tab-2", 3);
  });

  it("activates the tab on Enter", () => {
    const onActivate = vi.fn();
    const event = createKeyboardEvent({ key: "Enter" });

    handleTabKeyboard({
      tabId: "tab-1",
      event,
      tabs: [{ id: "tab-1", filePath: null, title: "One", isPinned: false }],
      onReorder: vi.fn(),
      onActivate,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("tab-1");
  });

  it("activates the tab on Space", () => {
    const onActivate = vi.fn();
    const event = createKeyboardEvent({ key: " " });

    handleTabKeyboard({
      tabId: "tab-1",
      event,
      tabs: [{ id: "tab-1", filePath: null, title: "One", isPinned: false }],
      onReorder: vi.fn(),
      onActivate,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith("tab-1");
  });

  it("does nothing when tabId is not found in tabs (fromIndex === -1)", () => {
    const onReorder = vi.fn();
    const onActivate = vi.fn();
    const event = createKeyboardEvent({ key: "ArrowLeft", altKey: true, shiftKey: true });

    handleTabKeyboard({
      tabId: "nonexistent",
      event,
      tabs: [{ id: "tab-1", filePath: null, title: "One", isPinned: false }],
      onReorder,
      onActivate,
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does nothing for unrelated keys", () => {
    const onReorder = vi.fn();
    const onActivate = vi.fn();
    const event = createKeyboardEvent({ key: "a" });

    handleTabKeyboard({
      tabId: "tab-1",
      event,
      tabs: [{ id: "tab-1", filePath: null, title: "One", isPinned: false }],
      onReorder,
      onActivate,
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("ignores key handling during IME composition", () => {
    const onReorder = vi.fn();
    const onActivate = vi.fn();
    const event = createKeyboardEvent({
      key: "ArrowRight",
      altKey: true,
      shiftKey: true,
      nativeEvent: { isComposing: true } as unknown as KeyboardEvent,
    });

    handleTabKeyboard({
      tabId: "tab-1",
      event,
      tabs: [{ id: "tab-1", filePath: null, title: "One", isPinned: false }],
      onReorder,
      onActivate,
    });

    expect(onReorder).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("arrow-key focus navigation (audit 20260612 H27)", () => {
  /** Build a jsdom tablist with three tab buttons; returns the buttons. */
  function buildTablist(): HTMLButtonElement[] {
    document.body.innerHTML = "";
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    const buttons = ["tab-1", "tab-2", "tab-3"].map((id) => {
      const b = document.createElement("button");
      b.setAttribute("role", "tab");
      b.dataset.tabId = id;
      tablist.appendChild(b);
      return b;
    });
    document.body.appendChild(tablist);
    return buttons;
  }

  function navEvent(key: string, target: HTMLElement): ReactKeyboardEvent {
    return {
      key,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      currentTarget: target,
      nativeEvent: { isComposing: false } as unknown as KeyboardEvent,
    } as unknown as ReactKeyboardEvent;
  }

  const tabs = [
    { id: "tab-1", filePath: null, title: "One", isPinned: false },
    { id: "tab-2", filePath: null, title: "Two", isPinned: false },
    { id: "tab-3", filePath: null, title: "Three", isPinned: false },
  ];

  function dispatch(key: string, fromIndex: number, buttons: HTMLButtonElement[]) {
    const event = navEvent(key, buttons[fromIndex]);
    handleTabKeyboard({
      tabId: tabs[fromIndex].id,
      event,
      tabs,
      onReorder: vi.fn(),
      onActivate: vi.fn(),
    });
    return event;
  }

  it("ArrowRight moves focus to the next tab", () => {
    const buttons = buildTablist();
    const event = dispatch("ArrowRight", 0, buttons);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(buttons[1]);
  });

  it("ArrowLeft moves focus to the previous tab", () => {
    const buttons = buildTablist();
    dispatch("ArrowLeft", 1, buttons);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps around at both ends", () => {
    const buttons = buildTablist();
    dispatch("ArrowRight", 2, buttons);
    expect(document.activeElement).toBe(buttons[0]);
    dispatch("ArrowLeft", 0, buttons);
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("Home and End jump to the first and last tab", () => {
    const buttons = buildTablist();
    dispatch("End", 0, buttons);
    expect(document.activeElement).toBe(buttons[2]);
    dispatch("Home", 2, buttons);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("plain arrows do not reorder", () => {
    const buttons = buildTablist();
    const onReorder = vi.fn();
    const event = navEvent("ArrowRight", buttons[0]);
    handleTabKeyboard({ tabId: "tab-1", event, tabs, onReorder, onActivate: vi.fn() });
    expect(onReorder).not.toHaveBeenCalled();
  });
});
