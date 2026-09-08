// WI-C.3 — PermissionsForm tests.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useWorkflowStore } from "@/stores/workflowStore";
import { PermissionsForm } from "../PermissionsForm";

beforeEach(() => {
  useWorkflowStore.getState().resetEdit();
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
    const patches = useWorkflowStore.getState().edit.pendingPatches;
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
      // Walk to the labelled ROW rather than the immediate parent: the select
      // sits inside a `.vm-select-field` wrapper that owns the chevron, so
      // `parentElement` is that wrapper and carries no scope name.
      (s.closest("label")?.textContent ?? "").includes("issues"),
    );
    fireEvent.change(issuesScope!, { target: { value: "write" } });
    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches).toContainEqual({
      kind: "workflow.permissions.set",
      value: { contents: "read", issues: "write" },
    });
  });

  // Audit R2 #573 — `applyPreviewPatches` skips `workflow.permissions.set`, so
  // the prop never reflects a queued edit. Deriving the scope map from it left
  // the SECOND scope edit computed from the pre-edit map, and the queue dedups
  // by target — so the first scope was silently dropped.
  it("accumulates two scope edits instead of dropping the first", () => {
    render(<PermissionsForm permissions={{ contents: "read" }} />);
    const scopeSelect = (name: string): HTMLElement =>
      screen
        .getAllByRole("combobox")
        .find((s) => (s.closest("label")?.textContent ?? "").includes(name))!;

    fireEvent.change(scopeSelect("issues"), { target: { value: "write" } });
    fireEvent.change(scopeSelect("packages"), { target: { value: "read" } });

    const patches = useWorkflowStore.getState().edit.pendingPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      kind: "workflow.permissions.set",
      value: { contents: "read", issues: "write", packages: "read" },
    });
  });

  it("shows a queued scope edit rather than the unchanged prop value", () => {
    render(<PermissionsForm permissions={{ contents: "read" }} />);
    const issues = screen
      .getAllByRole("combobox")
      .find((s) => (s.closest("label")?.textContent ?? "").includes("issues"))!;
    fireEvent.change(issues, { target: { value: "write" } });
    expect((issues as HTMLSelectElement).value).toBe("write");
  });

  it("keeps unsetting a scope working", () => {
    render(<PermissionsForm permissions={{ contents: "read", issues: "write" }} />);
    const issues = screen
      .getAllByRole("combobox")
      .find((s) => (s.closest("label")?.textContent ?? "").includes("issues"))!;
    fireEvent.change(issues, { target: { value: "" } });
    expect(useWorkflowStore.getState().edit.pendingPatches[0]).toEqual({
      kind: "workflow.permissions.set",
      value: { contents: "read" },
    });
  });
});
