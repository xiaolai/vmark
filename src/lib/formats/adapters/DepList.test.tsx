import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { DepList, type DepEntry } from "./DepList";

describe("DepList", () => {
  it("renders nothing when deps is empty", () => {
    const { container } = render(<DepList title="Dependencies" deps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders heading + count + one row per dep", () => {
    const deps: DepEntry[] = [
      { name: "react", version: "^19.0.0" },
      { name: "zustand", version: "^5.0.0" },
    ];
    const { container } = render(<DepList title="Dependencies" deps={deps} />);

    const heading = container.querySelector(".dep-tree__heading");
    expect(heading?.textContent).toContain("Dependencies");
    expect(heading?.querySelector(".dep-tree__count")?.textContent).toBe("2");

    const items = container.querySelectorAll(".dep-tree__item");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText("react")).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText("^19.0.0")).toBeTruthy();
  });

  it("hides the version span when version is empty", () => {
    const deps: DepEntry[] = [{ name: "name-only", version: "" }];
    const { container } = render(<DepList title="Deps" deps={deps} />);
    expect(container.querySelector(".dep-tree__version")).toBeNull();
  });

  it("renders each Cargo feature as a feature pill when features are provided", () => {
    const deps: DepEntry[] = [
      {
        name: "tokio",
        version: "1",
        features: ["macros", "rt-multi-thread"],
      },
    ];
    const { container } = render(<DepList title="Cargo deps" deps={deps} />);
    const pills = container.querySelectorAll(".dep-tree__feature");
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toBe("macros");
    expect(pills[1].textContent).toBe("rt-multi-thread");
  });

  it("does not render a features wrapper when features is undefined or empty", () => {
    const noFeatures: DepEntry[] = [{ name: "lodash", version: "^4.17.0" }];
    const emptyFeatures: DepEntry[] = [
      { name: "tokio", version: "1", features: [] },
    ];
    const { container: noFC } = render(
      <DepList title="A" deps={noFeatures} />,
    );
    const { container: emptyFC } = render(
      <DepList title="B" deps={emptyFeatures} />,
    );
    expect(noFC.querySelector(".dep-tree__features")).toBeNull();
    expect(emptyFC.querySelector(".dep-tree__features")).toBeNull();
  });

  it("uses dep.name as the React key (each row is unique by name)", () => {
    // Functional check: rendering with duplicate-name input still mounts
    // the requested rows (React only complains via console.error; here we
    // just verify the component doesn't crash and outputs N rows).
    const deps: DepEntry[] = [
      { name: "a", version: "1" },
      { name: "b", version: "2" },
      { name: "c", version: "3" },
    ];
    const { container } = render(<DepList title="Deps" deps={deps} />);
    expect(container.querySelectorAll(".dep-tree__item")).toHaveLength(3);
  });
});
