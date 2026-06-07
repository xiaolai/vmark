// RW-7 (L3) — wire GHA workflow export to UI
//
// Behavior tests for the export control: opening the menu and clicking
// each action invokes the right export function. The pure render
// functions (toMermaid / exportCanvas) and the I/O glue (saveExport)
// have their own unit tests; here we only verify the UI dispatch.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowIR } from "@/lib/ghaWorkflow/types";

vi.mock("@/lib/ghaWorkflow/export/toMermaid", () => ({
  toMermaid: vi.fn(() => "flowchart TD\n  build"),
}));
vi.mock("@/lib/ghaWorkflow/export/saveExport", () => ({
  copyMermaid: vi.fn(async () => true),
  saveImage: vi.fn(async () => "saved"),
}));
vi.mock("@/services/ime/imeToast", () => ({
  imeToast: { success: vi.fn(), error: vi.fn() },
}));

import { toMermaid } from "@/lib/ghaWorkflow/export/toMermaid";
import { copyMermaid, saveImage } from "@/lib/ghaWorkflow/export/saveExport";
import { WorkflowExportControl } from "../WorkflowExportControl";

const mockToMermaid = toMermaid as unknown as ReturnType<typeof vi.fn>;
const mockCopyMermaid = copyMermaid as unknown as ReturnType<typeof vi.fn>;
const mockSaveImage = saveImage as unknown as ReturnType<typeof vi.fn>;

const ir = (): WorkflowIR => ({
  triggers: [],
  permissions: {},
  env: {},
  jobs: [
    {
      id: "build",
      needs: [],
      steps: [],
      position: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
    },
  ],
  positions: {},
  diagnostics: [],
});

describe("WorkflowExportControl", () => {
  beforeEach(() => {
    mockToMermaid.mockClear();
    mockCopyMermaid.mockClear();
    mockSaveImage.mockClear();
  });

  it("menu items are hidden until the trigger is clicked", () => {
    render(<WorkflowExportControl workflow={ir()} />);
    expect(
      screen.queryByRole("menuitem", { name: /mermaid/i }),
    ).not.toBeInTheDocument();
  });

  it("copies Mermaid from the IR when 'Copy as Mermaid' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowExportControl workflow={ir()} />);
    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /mermaid/i }));
    expect(mockToMermaid).toHaveBeenCalledWith(expect.objectContaining({
      jobs: expect.any(Array),
    }));
    expect(mockCopyMermaid).toHaveBeenCalledWith("flowchart TD\n  build");
  });

  it("exports SVG when 'Export as SVG' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowExportControl workflow={ir()} />);
    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /svg/i }));
    expect(mockSaveImage).toHaveBeenCalledWith("svg");
  });

  it("exports PNG when 'Export as PNG' is clicked", async () => {
    const user = userEvent.setup();
    render(<WorkflowExportControl workflow={ir()} />);
    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("menuitem", { name: /png/i }));
    expect(mockSaveImage).toHaveBeenCalledWith("png");
  });

  // audit-fix — rapid repeated clicks must not trigger duplicate exports.
  it("ignores a rapid double-click while an export is in flight", async () => {
    const user = userEvent.setup();
    // Hold the export open so the second click lands while it is in flight.
    let release: () => void = () => {};
    mockCopyMermaid.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      }),
    );

    render(<WorkflowExportControl workflow={ir()} />);
    await user.click(screen.getByRole("button", { name: /export/i }));

    const item = screen.getByRole("menuitem", { name: /mermaid/i });
    // Fire two clicks back-to-back before the in-flight promise resolves.
    fireEvent.click(item);
    fireEvent.click(item);

    release();
    await waitFor(() => {
      expect(mockCopyMermaid).toHaveBeenCalledTimes(1);
    });
  });
});
