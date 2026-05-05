// WI-C.3 — PermissionsForm tests.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkflowEditStore } from "@/stores/workflowEditStore";
import { PermissionsForm } from "../PermissionsForm";

beforeEach(() => {
  useWorkflowEditStore.setState({
    pendingPatches: [],
    preserveYamlFormatting: true,
  });
});

describe("PermissionsForm", () => {
  it("renders 'default' selected when permissions is undefined", () => {
    render(<PermissionsForm permissions={undefined} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("default");
  });

  it("renders the matching string preset when permissions is read-all", () => {
    render(<PermissionsForm permissions="read-all" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("read-all");
  });

  it("queues workflow.permissions.set when user picks a string preset", () => {
    render(<PermissionsForm permissions={undefined} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "write-all" },
    });
    const patches = useWorkflowEditStore.getState().pendingPatches;
    expect(patches).toContainEqual({
      kind: "workflow.permissions.set",
      value: "write-all",
    });
  });

  it("renders custom-scope selectors when mode is 'custom'", () => {
    render(<PermissionsForm permissions={{ contents: "read" }} />);
    // contents scope label appears + its select shows "read"
    expect(screen.getByText("contents")).toBeTruthy();
    const allSelects = screen.getAllByRole("combobox");
    // First select is the mode picker; subsequent are scope-level pickers.
    const scopePickers = allSelects.slice(1);
    const contentsSelect = scopePickers.find((s) => {
      const value = (s as HTMLSelectElement).value;
      return value === "read";
    });
    expect(contentsSelect).toBeTruthy();
  });

  it("queues workflow.permissions.set with mapping when scope value changes", () => {
    render(<PermissionsForm permissions={{ contents: "read" }} />);
    const allSelects = screen.getAllByRole("combobox");
    const issuesScope = allSelects.find((s) =>
      // The select for 'issues' starts empty.
      (s.parentElement?.textContent ?? "").includes("issues"),
    );
    fireEvent.change(issuesScope!, { target: { value: "write" } });
    const patches = useWorkflowEditStore.getState().pendingPatches;
    expect(patches).toContainEqual({
      kind: "workflow.permissions.set",
      value: { contents: "read", issues: "write" },
    });
  });
});
