// DocumentWindowMount — the conditional-mount wrapper must run the
// document composite before the window composite and render nothing.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("../useDocumentLifecycle", () => ({
  useDocumentLifecycle: () => calls.push("documentLifecycle"),
}));
vi.mock("../useWindowLifecycle", () => ({
  useWindowLifecycle: () => calls.push("windowLifecycle"),
}));

import { DocumentWindowMount } from "../DocumentWindowMount";

beforeEach(() => {
  calls.length = 0;
});

describe("DocumentWindowMount", () => {
  it("mounts the document composite before the window composite", () => {
    render(<DocumentWindowMount />);
    expect(calls).toEqual(["documentLifecycle", "windowLifecycle"]);
  });

  it("renders no visible DOM (pure lifecycle wiring)", () => {
    const { container } = render(<DocumentWindowMount />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not re-run the composites after unmount", () => {
    const { unmount } = render(<DocumentWindowMount />);
    unmount();
    expect(calls).toEqual(["documentLifecycle", "windowLifecycle"]);
  });
});
