import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  findNextEnabled,
  findEdgeEnabled,
  useMenuRovingFocus,
  type RovingMenuItem,
} from "./useMenuRovingFocus";

vi.mock("@/utils/imeGuard", () => ({
  isImeKeyEvent: vi.fn(() => false),
}));
import { isImeKeyEvent } from "@/utils/imeGuard";

/* ─────────────────────────── helpers ─────────────────────────────────── */

const noSelection: RovingMenuItem[] = [
  { disabled: true },
  { disabled: true },
  {},
  {},
  {},
];
const allEnabled: RovingMenuItem[] = [{}, {}, {}];

describe("findNextEnabled", () => {
  it("skips disabled items forward and wraps", () => {
    expect(findNextEnabled(noSelection, 2, 1)).toBe(3);
    expect(findNextEnabled(noSelection, 4, 1)).toBe(2);
  });

  it("skips disabled items backward and wraps", () => {
    expect(findNextEnabled(noSelection, 2, -1)).toBe(4);
  });

  it("wraps forward from the last item", () => {
    expect(findNextEnabled(allEnabled, 2, 1)).toBe(0);
  });

  it("returns the same index when only one item is enabled", () => {
    const one: RovingMenuItem[] = [{ disabled: true }, {}, { disabled: true }];
    expect(findNextEnabled(one, 1, 1)).toBe(1);
    expect(findNextEnabled(one, 1, -1)).toBe(1);
  });

  it("returns the current index when every item is disabled", () => {
    const all: RovingMenuItem[] = [{ disabled: true }, { disabled: true }];
    expect(findNextEnabled(all, 0, 1)).toBe(0);
  });

  it("returns -1 for an empty list", () => {
    expect(findNextEnabled([], 0, 1)).toBe(-1);
    expect(findNextEnabled([], 0, -1)).toBe(-1);
  });
});

describe("findEdgeEnabled", () => {
  it("returns the first / last enabled item, skipping disabled", () => {
    expect(findEdgeEnabled(noSelection, 1)).toBe(2);
    expect(findEdgeEnabled(noSelection, -1)).toBe(4);
  });

  it("returns -1 for an empty list", () => {
    expect(findEdgeEnabled([], 1)).toBe(-1);
  });

  it("returns -1 when every item is disabled (no focusable target)", () => {
    const allDisabled: RovingMenuItem[] = [{ disabled: true }, { disabled: true }];
    expect(findEdgeEnabled(allDisabled, 1)).toBe(-1);
    expect(findEdgeEnabled(allDisabled, -1)).toBe(-1);
  });
});

/* ───────────────────────── hook harness ──────────────────────────────── */

interface HarnessItem extends RovingMenuItem {
  id: string;
}

function Harness({
  items,
  onActivate,
  onDismiss,
  enabled = true,
}: {
  items: HarnessItem[];
  onActivate: (item: HarnessItem, index: number) => void;
  onDismiss: () => void;
  enabled?: boolean;
}) {
  const { handleKeyDown, registerItem, itemProps } = useMenuRovingFocus({
    items,
    onActivate,
    onDismiss,
    enabled,
  });
  return (
    <div role="menu" aria-label="harness" onKeyDown={handleKeyDown}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => registerItem(index, node)}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => onActivate(item, index)}
          {...itemProps(index)}
        >
          {item.id}
        </button>
      ))}
    </div>
  );
}

const menuItems: HarnessItem[] = [
  { id: "copy", disabled: true },
  { id: "paste" },
  { id: "selectAll" },
  { id: "clear" },
];

describe("useMenuRovingFocus (integration)", () => {
  let onActivate: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onActivate = vi.fn();
    onDismiss = vi.fn();
  });

  it("focuses the first enabled item on mount (disabled copy skipped)", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "paste" }));
  });

  it("ArrowDown/ArrowUp navigate, skipping disabled and wrapping", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" }); // paste → selectAll
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "selectAll" }));
    fireEvent.keyDown(menu, { key: "ArrowUp" }); // back to paste
    fireEvent.keyDown(menu, { key: "ArrowUp" }); // wrap past disabled copy → clear
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "clear" }));
  });

  it("Home/End jump to first/last enabled", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "clear" }));
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "paste" }));
  });

  it("Enter and Space activate the focused item", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Enter" }); // paste focused on open
    expect(onActivate).toHaveBeenCalledWith(menuItems[1], 1);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: " " });
    expect(onActivate).toHaveBeenCalledWith(menuItems[2], 2);
  });

  it("never lands the roving target on a disabled item", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");
    const copy = screen.getByRole("menuitem", { name: "copy" });
    for (const key of ["Home", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowDown"]) {
      fireEvent.keyDown(menu, { key });
      expect(copy.tabIndex).toBe(-1);
    }
  });

  it("Escape and Tab dismiss; Escape stops propagation", () => {
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("ignores IME composition keystrokes", () => {
    vi.mocked(isImeKeyEvent).mockReturnValueOnce(true);
    render(<Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} />);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape", isComposing: true });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not seed focus while disabled (closed singleton)", () => {
    render(
      <Harness items={menuItems} onActivate={onActivate} onDismiss={onDismiss} enabled={false} />,
    );
    // No menuitem focused (focusedIndex stays -1).
    expect(document.activeElement).toBe(document.body);
  });

  it("does not focus any item when every item is disabled", () => {
    const allDisabled: HarnessItem[] = [
      { id: "x", disabled: true },
      { id: "y", disabled: true },
    ];
    render(<Harness items={allDisabled} onActivate={onActivate} onDismiss={onDismiss} />);
    // No roving target on a disabled item — focusedIndex stays -1.
    expect(document.activeElement).toBe(document.body);
    for (const el of screen.getAllByRole("menuitem")) {
      expect((el as HTMLButtonElement).tabIndex).toBe(-1);
    }
  });

  it("refocuses the new index-0 node on a reset-key swap that keeps index 0", () => {
    // Focus never leaves index 0, so setFocusedIndex(0) is a no-op and the
    // focusedIndex effect can't fire — the seed effect's direct focus is the
    // only thing that moves focus to the new node at index 0.
    function ZeroHarness({ set }: { set: "a" | "b" }) {
      const listA: HarnessItem[] = [{ id: "a1" }, { id: "a2" }];
      const listB: HarnessItem[] = [{ id: "b1" }, { id: "b2" }];
      const items = set === "a" ? listA : listB;
      const nav = useMenuRovingFocus({ items, onActivate, onDismiss, resetKey: set });
      return (
        <div role="menu" onKeyDown={nav.handleKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(n) => nav.registerItem(index, n)}
              type="button"
              role="menuitem"
              {...nav.itemProps(index)}
            >
              {item.id}
            </button>
          ))}
        </div>
      );
    }

    const { rerender } = render(<ZeroHarness set="a" />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "a1" }));

    rerender(<ZeroHarness set="b" />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "b1" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("re-seeds focus into the new items when resetKey changes (shape swap)", () => {
    function ResetHarness({ set }: { set: "a" | "b" }) {
      const listA: HarnessItem[] = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
      const listB: HarnessItem[] = [{ id: "b1" }, { id: "b2" }];
      const items = set === "a" ? listA : listB;
      const { handleKeyDown, registerItem, itemProps } = useMenuRovingFocus({
        items,
        onActivate,
        onDismiss,
        resetKey: set,
      });
      return (
        <div role="menu" onKeyDown={handleKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(n) => registerItem(index, n)}
              type="button"
              role="menuitem"
              {...itemProps(index)}
            >
              {item.id}
            </button>
          ))}
        </div>
      );
    }

    const { rerender } = render(<ResetHarness set="a" />);
    // Navigate to the last item of set A.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "a3" }));

    // Swap the item set in place — focus must move into set B's first item,
    // not fall to <body> (which would break menu-owned Escape).
    rerender(<ResetHarness set="b" />);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "b1" }));
    // Escape still reaches the menu because focus stayed inside it.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("re-seeds to the FIRST item on a same-length swap where the old index still exists", () => {
    // Regression (round 2): if the stale focusedIndex is still valid in the
    // new set, the seed must still win — focus goes to the new first item,
    // not the same index in the swapped set.
    function OverlapHarness({ set }: { set: "a" | "b" }) {
      const listA: HarnessItem[] = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
      const listB: HarnessItem[] = [{ id: "b1" }, { id: "b2" }, { id: "b3" }];
      const items = set === "a" ? listA : listB;
      const { handleKeyDown, registerItem, itemProps } = useMenuRovingFocus({
        items,
        onActivate,
        onDismiss,
        resetKey: set,
      });
      return (
        <div role="menu" onKeyDown={handleKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(n) => registerItem(index, n)}
              type="button"
              role="menuitem"
              {...itemProps(index)}
            >
              {item.id}
            </button>
          ))}
        </div>
      );
    }

    const { rerender } = render(<OverlapHarness set="a" />);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" }); // A index 2 (a3)
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "a3" }));

    rerender(<OverlapHarness set="b" />); // index 2 (b3) still exists
    // Must land on b1 (first), NOT b3 (the stale index).
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "b1" }));
  });
});
