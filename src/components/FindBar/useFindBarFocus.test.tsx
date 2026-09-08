// Audit 20260907 (#301): the FindBar's two focus effects — select the find
// input when the bar opens, and seed it from the editor selection on the
// Mod+E relay event — extracted from the component.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { useRef, useState } from "react";

const seedFindFromSelection = vi.fn();
vi.mock("@/services/search/seedFindFromSelection", () => ({
  seedFindFromSelection: () => seedFindFromSelection(),
}));

import { useFindBarFocus } from "./useFindBarFocus";

function mountInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.value = value;
  document.body.appendChild(input);
  return input;
}

afterEach(() => {
  document.body.innerHTML = "";
  seedFindFromSelection.mockReset();
});

describe("useFindBarFocus", () => {
  it("focuses and selects the find input when the bar opens, not before", () => {
    const input = mountInput("needle");
    const ref = { current: input };
    const { rerender } = renderHook(({ open }) => useFindBarFocus(open, ref), {
      initialProps: { open: false },
    });
    expect(document.activeElement).not.toBe(input);

    rerender({ open: true });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("needle".length);
  });

  it("tolerates an open bar whose input is not mounted yet", () => {
    const ref = { current: null };
    expect(() => renderHook(() => useFindBarFocus(true, ref))).not.toThrow();
  });

  it("seeds the query from the editor selection on the Mod+E relay event and selects the input", () => {
    const input = mountInput("seeded");
    const ref = { current: input };
    renderHook(() => useFindBarFocus(false, ref));

    act(() => {
      window.dispatchEvent(new CustomEvent("use-selection-for-find"));
    });

    expect(seedFindFromSelection).toHaveBeenCalledTimes(1);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("seeded".length);
  });

  // Audit R2 (#599): the field is CONTROLLED by the store's query, so seeding
  // and selecting in the same turn selected the text the box was about to
  // lose — and Mod+E on an already-open bar never crossed the isOpen edge, so
  // nothing focused the field either.
  it("focuses and selects the NEW query, not the one the box still shows", () => {
    function Bar() {
      const [query, setQuery] = useState("old");
      const ref = useRef<HTMLInputElement | null>(null);
      seedFindFromSelection.mockImplementation(() => {
        setQuery("a much longer needle");
      });
      useFindBarFocus(true, ref);
      return <input ref={ref} value={query} onChange={() => {}} />;
    }
    render(<Bar />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    input.blur();

    act(() => {
      window.dispatchEvent(new CustomEvent("use-selection-for-find"));
    });

    expect(input.value).toBe("a much longer needle");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("a much longer needle".length);
  });

  it("stops listening for the relay event after unmount", () => {
    const ref = { current: mountInput("x") };
    const { unmount } = renderHook(() => useFindBarFocus(false, ref));
    unmount();

    window.dispatchEvent(new CustomEvent("use-selection-for-find"));
    expect(seedFindFromSelection).not.toHaveBeenCalled();
  });
});

// Audit 20260907 round 3 (#595): closing the bar unmounted the focused input
// and left keyboard focus on `document.body` — the editor the user was typing
// in a moment ago no longer had it, and nothing else claimed it, so the next
// keystroke went nowhere.
describe("useFindBarFocus — where focus goes when the bar closes", () => {
  it("returns focus to whatever had it when the bar opened", () => {
    const editor = document.createElement("div");
    editor.tabIndex = -1;
    document.body.appendChild(editor);
    editor.focus();
    expect(document.activeElement).toBe(editor);

    const input = mountInput("needle");
    const ref = { current: input };
    const { rerender } = renderHook(({ open }) => useFindBarFocus(open, ref), {
      initialProps: { open: false },
    });

    rerender({ open: true });
    expect(document.activeElement).toBe(input);

    rerender({ open: false });
    expect(document.activeElement).toBe(editor);
  });

  it("does not chase an element that has since been removed", () => {
    const editor = document.createElement("div");
    editor.tabIndex = -1;
    document.body.appendChild(editor);
    editor.focus();

    const input = mountInput("needle");
    const ref = { current: input };
    const { rerender } = renderHook(({ open }) => useFindBarFocus(open, ref), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    editor.remove();

    expect(() => rerender({ open: false })).not.toThrow();
    expect(document.activeElement).not.toBe(editor);
  });

  it("does not try to restore focus to the find input itself", () => {
    const input = mountInput("needle");
    input.focus();
    const ref = { current: input };
    const { rerender } = renderHook(({ open }) => useFindBarFocus(open, ref), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    // Nothing to restore to — the bar's own field was the only focused thing,
    // so the hook moves focus nowhere.
    expect(document.activeElement).toBe(input);
  });
});
