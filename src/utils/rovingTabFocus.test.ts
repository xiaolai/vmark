import { describe, expect, it, beforeEach } from "vitest";
import { isRovingNavKey, moveRovingTabFocus } from "./rovingTabFocus";

function buildTablist(count = 3): HTMLButtonElement[] {
  document.body.innerHTML = "";
  const tablist = document.createElement("div");
  tablist.setAttribute("role", "tablist");
  const buttons = Array.from({ length: count }, (_, i) => {
    const b = document.createElement("button");
    b.setAttribute("role", "tab");
    b.dataset.i = String(i);
    tablist.appendChild(b);
    return b;
  });
  document.body.appendChild(tablist);
  return buttons;
}

describe("isRovingNavKey", () => {
  it("recognizes the four navigation keys and nothing else", () => {
    expect(["ArrowLeft", "ArrowRight", "Home", "End"].every(isRovingNavKey)).toBe(true);
    expect(["Enter", " ", "ArrowUp", "a"].some(isRovingNavKey)).toBe(false);
  });
});

describe("moveRovingTabFocus", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ArrowRight/ArrowLeft move focus and wrap around", () => {
    const b = buildTablist();
    expect(moveRovingTabFocus(b[0], "ArrowRight")).toBe(true);
    expect(document.activeElement).toBe(b[1]);
    moveRovingTabFocus(b[2], "ArrowRight");
    expect(document.activeElement).toBe(b[0]); // wrap
    moveRovingTabFocus(b[0], "ArrowLeft");
    expect(document.activeElement).toBe(b[2]); // wrap
  });

  it("Home and End jump to the first and last tab", () => {
    const b = buildTablist();
    moveRovingTabFocus(b[1], "End");
    expect(document.activeElement).toBe(b[2]);
    moveRovingTabFocus(b[2], "Home");
    expect(document.activeElement).toBe(b[0]);
  });

  it("returns false when origin is not inside a tablist", () => {
    const orphan = document.createElement("button");
    orphan.setAttribute("role", "tab");
    document.body.appendChild(orphan);
    expect(moveRovingTabFocus(orphan, "ArrowRight")).toBe(false);
  });

  it("works when the origin is a child of the tab element", () => {
    const b = buildTablist();
    const icon = document.createElement("span");
    b[0].appendChild(icon);
    expect(moveRovingTabFocus(icon, "ArrowRight")).toBe(true);
    expect(document.activeElement).toBe(b[1]);
  });
});
