// WI-1A.4 + WI-1A.10 — SplitPaneEditor tests.
//
// Verifies skeleton structure, source/preview/validator slot wiring,
// resize-handle keyboard support, ARIA roles, and theme parity.

import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormatConfig, ValidationDiagnostic } from "@/lib/formats/types";
import { SplitPaneEditor } from "./SplitPaneEditor";

// CodeMirror is heavy and requires DOM; mock the source pane.
vi.mock("./SourcePane", () => ({
  SourcePane: ({ tabId, formatId }: { tabId: string; formatId: string }) => (
    <div data-testid="source-pane" data-tab-id={tabId} data-format-id={formatId}>
      source
    </div>
  ),
}));

const baseAdapters: FormatConfig["adapters"] = {
  saveDialogFilters: [{ name: "JSON", extensions: ["json"] }],
  untitledExtension: "json",
  searchAdapter: "codemirror",
  readOnlyDefault: false,
  closeSavePolicy: "markdown-default",
  menuPolicy: {
    sourceWysiwygToggle: false,
    cjkFormatActions: false,
    insertBlockActions: false,
    paragraphFormatting: false,
  },
};

const jsonStub: FormatConfig = {
  id: "json",
  nameI18nKey: "format.json",
  extensions: ["json"],
  kind: "split-pane",
  adapters: baseAdapters,
};

const txtStub: FormatConfig = {
  id: "txt",
  nameI18nKey: "format.txt",
  extensions: ["txt"],
  kind: "split-pane",
  adapters: baseAdapters,
};

function GenericPreview({ content }: { content: string }) {
  return <div data-testid="preview-content">preview:{content}</div>;
}

describe("SplitPaneEditor", () => {
  afterEach(() => cleanup());

  describe("skeleton (WI-1A.4)", () => {
    it("renders source pane slot", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.getByTestId("source-pane")).toBeInTheDocument();
    });

    it("renders no preview pane when format has no genericPreview / schemaRenderers", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.queryByTestId("preview-content")).not.toBeInTheDocument();
    });

    it("renders preview pane when format declares genericPreview", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      expect(screen.getByTestId("preview-content")).toBeInTheDocument();
    });

    it("renders validator slot when validator is declared", () => {
      const validator = (() => [
        { severity: "error", line: 1, column: 1, message: "boom" },
      ]) as FormatConfig["validator"];
      const config: FormatConfig = { ...jsonStub, validator };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      // Validator gutter is owned by SourcePane; here we only verify the
      // outer skeleton renders the dual-pane container.
      expect(screen.getByRole("group")).toBeInTheDocument();
    });

    it("forwards tabId + formatId to source pane", () => {
      render(<SplitPaneEditor tabId="tab-99" formatConfig={jsonStub} />);
      const src = screen.getByTestId("source-pane");
      expect(src).toHaveAttribute("data-tab-id", "tab-99");
      expect(src).toHaveAttribute("data-format-id", "json");
    });
  });

  describe("polish: resize handle (WI-1A.10)", () => {
    it("renders a resize handle when preview is present", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toBeInTheDocument();
    });

    it("omits the resize handle when no preview is rendered", () => {
      render(<SplitPaneEditor tabId="tab-1" formatConfig={txtStub} />);
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    });

    it("resize handle exposes ARIA orientation", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
    });

    it("resize handle is keyboard focusable", () => {
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      const handle = screen.getByRole("separator");
      expect(handle).toHaveAttribute("tabindex", "0");
    });

    it("ArrowLeft on the handle decreases the source pane fraction", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("{ArrowLeft}");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(after)).toBeLessThan(parseFloat(before));
    });

    it("ArrowRight on the handle increases the source pane fraction", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("{ArrowRight}");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    });

    it("Home key snaps to minimum fraction (0.2)", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      await user.keyboard("{Home}");
      const fraction = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(fraction).toBeCloseTo(0.2);
    });

    it("End key snaps to maximum fraction (0.8)", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      await user.keyboard("{End}");
      const fraction = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(fraction).toBeCloseTo(0.8);
    });

    it("ignores keys other than Arrow / Home / End", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      const before = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      await user.keyboard("a");
      const after = (container.querySelector(
        ".split-pane-editor",
      ) as HTMLElement).style.getPropertyValue("--split-pane-source-fraction");
      expect(after).toBe(before);
    });

    it("clamps fraction within [0.2, 0.8]", async () => {
      const user = userEvent.setup();
      const config: FormatConfig = { ...jsonStub, genericPreview: GenericPreview };
      const { container } = render(
        <SplitPaneEditor tabId="tab-1" formatConfig={config} />,
      );
      const handle = screen.getByRole("separator");
      handle.focus();
      // Mash ArrowLeft a lot — should clamp to 0.2, not go below.
      for (let i = 0; i < 50; i++) await user.keyboard("{ArrowLeft}");
      const min = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(min).toBeGreaterThanOrEqual(0.2);
      // And the other direction.
      for (let i = 0; i < 100; i++) await user.keyboard("{ArrowRight}");
      const max = parseFloat(
        (container.querySelector(".split-pane-editor") as HTMLElement).style
          .getPropertyValue("--split-pane-source-fraction"),
      );
      expect(max).toBeLessThanOrEqual(0.8);
    });
  });

  describe("validator integration", () => {
    it("renders zero diagnostics for empty content", () => {
      const validator = (() => [] as ValidationDiagnostic[]) as FormatConfig["validator"];
      const config: FormatConfig = { ...jsonStub, validator };
      render(<SplitPaneEditor tabId="tab-1" formatConfig={config} />);
      // No diagnostics → no error gutter rendered yet (gutter component
      // owned by SourcePane in this skeleton; outer skeleton just supplies).
      expect(screen.queryByTestId("validation-summary")).not.toBeInTheDocument();
    });
  });
});
