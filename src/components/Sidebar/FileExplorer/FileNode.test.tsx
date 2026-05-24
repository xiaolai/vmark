/**
 * FileNode tests
 *
 * WI-2.1 — a11y regression tests for the folder expand/collapse button.
 *
 * The chevron was previously a `<span onClick>` which keyboard users
 * couldn't operate. It is now a `<button>` with aria-label and
 * aria-expanded reflecting live folder state.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { FileNode } from "./FileNode";
import type { FileNode as FileNodeType } from "./types";

// react-i18next mock — return the key as the translated string so the
// assertions can match against keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Minimal stub of the react-arborist `NodeApi`-shaped object the
// component consumes. We only need the fields FileNode actually reads.
function buildNode(opts: {
  data: FileNodeType;
  isOpen: boolean;
  toggle?: () => void;
}) {
  return {
    data: opts.data,
    isOpen: opts.isOpen,
    isEditing: false,
    isSelected: false,
    toggle: opts.toggle ?? vi.fn(),
    reset: vi.fn(),
    submit: vi.fn(),
  };
}

function renderFolderNode(opts: { isOpen: boolean; onToggle?: () => void }) {
  const data: FileNodeType = {
    id: "/folder",
    name: "folder",
    isFolder: true,
  };
  const node = buildNode({
    data,
    isOpen: opts.isOpen,
    toggle: opts.onToggle,
  });
  return render(
    <FileNode
      // react-arborist passes a NodeApi with extra methods; the cast is safe
      // because FileNode reads only the fields stubbed above.
       
      node={node as any}
      style={{}}
      dragHandle={undefined}
      currentFilePath={null}
      // unused renderer props that react-arborist supplies; cast to any.
       
      tree={{} as any}
       
      preview={false as any}
    />,
  );
}

describe("FileNode — folder chevron (WI-2.1 a11y)", () => {
  it("renders the chevron as a <button> (not a <span>)", () => {
    renderFolderNode({ isOpen: false });
    const btn = screen.getByRole("button", { name: /expand|collapse/i });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("exposes 'expandFolder' aria-label when folder is closed", () => {
    renderFolderNode({ isOpen: false });
    const btn = screen.getByRole("button", { name: "expandFolder" });
    expect(btn).toBeDefined();
  });

  it("exposes 'collapseFolder' aria-label when folder is open", () => {
    renderFolderNode({ isOpen: true });
    const btn = screen.getByRole("button", { name: "collapseFolder" });
    expect(btn).toBeDefined();
  });

  it("binds aria-expanded to the live folder state", () => {
    const { rerender } = renderFolderNode({ isOpen: false });
    expect(
      screen.getByRole("button").getAttribute("aria-expanded"),
    ).toBe("false");

    const data: FileNodeType = {
      id: "/folder",
      name: "folder",
      isFolder: true,
    };
    rerender(
      <FileNode
         
        node={buildNode({ data, isOpen: true }) as any}
        style={{}}
        dragHandle={undefined}
        currentFilePath={null}
         
        tree={{} as any}
         
        preview={false as any}
      />,
    );
    expect(
      screen.getByRole("button").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("toggles the folder on Enter key", async () => {
    const onToggle = vi.fn();
    renderFolderNode({ isOpen: false, onToggle });
    const user = userEvent.setup();

    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard("{Enter}");

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles the folder on Space key", async () => {
    const onToggle = vi.fn();
    renderFolderNode({ isOpen: false, onToggle });
    const user = userEvent.setup();

    const btn = screen.getByRole("button");
    btn.focus();
    await user.keyboard(" ");

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles the folder on mouse click", async () => {
    const onToggle = vi.fn();
    renderFolderNode({ isOpen: false, onToggle });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button"));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not render a button for file nodes (only folders)", () => {
    const data: FileNodeType = {
      id: "/x.md",
      name: "x.md",
      isFolder: false,
    };
    render(
      <FileNode
         
        node={buildNode({ data, isOpen: false }) as any}
        style={{}}
        dragHandle={undefined}
        currentFilePath={null}
         
        tree={{} as any}
         
        preview={false as any}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /expand|collapse/i }),
    ).toBeNull();
  });
});

describe("FileNode — inline rename", () => {
  function renderEditing(opts: {
    isFolder?: boolean;
    submit?: (value: string) => void;
    reset?: () => void;
  } = {}) {
    const data: FileNodeType = {
      id: "/file.md",
      name: "file.md",
      isFolder: opts.isFolder ?? false,
    };
    const node = {
      data,
      isOpen: false,
      isEditing: true,
      isSelected: false,
      toggle: vi.fn(),
      reset: opts.reset ?? vi.fn(),
      submit: opts.submit ?? vi.fn(),
    };
    return render(
      <FileNode
        node={node as never}
        style={{}}
        dragHandle={undefined}
        currentFilePath={null}
        tree={{} as never}
        preview={false as never}
      />,
    );
  }

  it("renders an editable input pre-filled with the node name", () => {
    renderEditing();
    const input = screen.getByDisplayValue("file.md") as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
  });

  it("Escape calls node.reset() to cancel rename", async () => {
    const reset = vi.fn();
    renderEditing({ reset });
    const user = userEvent.setup();

    const input = screen.getByDisplayValue("file.md");
    input.focus();
    await user.keyboard("{Escape}");

    expect(reset).toHaveBeenCalled();
  });

  it("Enter calls node.submit() with the current input value", async () => {
    const submit = vi.fn();
    renderEditing({ submit });
    const user = userEvent.setup();

    const input = screen.getByDisplayValue("file.md");
    await user.click(input);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("renamed.md");
    await user.keyboard("{Enter}");

    expect(submit).toHaveBeenCalledWith("renamed.md");
  });

  it("blur calls node.reset() to abandon rename", () => {
    const reset = vi.fn();
    renderEditing({ reset });

    const input = screen.getByDisplayValue("file.md");
    input.focus();
    input.blur();

    expect(reset).toHaveBeenCalled();
  });
});
