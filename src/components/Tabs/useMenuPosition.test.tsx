import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { useMenuPosition, type ContextMenuPosition } from "./useMenuPosition";

const MENU_WIDTH = 180;
const MENU_HEIGHT = 300;

function Menu({ position }: { position: ContextMenuPosition }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuPosition(ref, position);
  return <div ref={ref} data-testid="menu" />;
}

function renderMenu(position: ContextMenuPosition) {
  const { getByTestId, rerender } = render(<Menu position={position} />);
  const menu = getByTestId("menu") as HTMLDivElement;
  return {
    menu,
    rerender: (next: ContextMenuPosition) => rerender(<Menu position={next} />),
  };
}

beforeEach(() => {
  window.innerWidth = 1000;
  window.innerHeight = 800;
  // jsdom reports a zero-sized rect for every element; give the menu a real box
  // so the overflow branches are actually exercised.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMenuPosition", () => {
  it("places the menu at the requested coordinates when it fits", () => {
    const { menu } = renderMenu({ x: 120, y: 60 });

    expect(menu.style.left).toBe("120px");
    expect(menu.style.top).toBe("60px");
  });

  it("pulls the menu back inside on right/bottom overflow", () => {
    const { menu } = renderMenu({ x: 990, y: 790 });

    // Flush against the far edges, minus the menu size and the 10px margin.
    expect(menu.style.left).toBe(`${1000 - MENU_WIDTH - 10}px`);
    expect(menu.style.top).toBe(`${800 - MENU_HEIGHT - 10}px`);
  });

  it("keeps the margin when the menu is larger than the viewport", () => {
    window.innerWidth = 100;
    window.innerHeight = 100;
    const { menu } = renderMenu({ x: 90, y: 90 });

    expect(menu.style.left).toBe("10px");
    expect(menu.style.top).toBe("10px");
  });

  it("re-applies the position when it changes", () => {
    const { menu, rerender } = renderMenu({ x: 10, y: 10 });

    rerender({ x: 300, y: 200 });

    expect(menu.style.left).toBe("300px");
    expect(menu.style.top).toBe("200px");
  });

  it("re-clamps on viewport resize", () => {
    const { menu } = renderMenu({ x: 700, y: 400 });
    expect(menu.style.left).toBe("700px");

    window.innerWidth = 500;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(menu.style.left).toBe(`${500 - MENU_WIDTH - 10}px`);
  });

  it("detaches its viewport listeners on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Menu position={{ x: 10, y: 10 }} />);

    unmount();

    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function), true);
  });
});
