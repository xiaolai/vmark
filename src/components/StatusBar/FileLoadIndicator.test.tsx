import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (!params) return key;
      return `${key}|size=${params.size}`;
    },
  }),
}));

import { FileLoadIndicator } from "./FileLoadIndicator";
import { useFileLoadStore } from "@/stores/fileLoadStore";

describe("FileLoadIndicator", () => {
  beforeEach(() => {
    cleanup();
    useFileLoadStore.getState().endLoad();
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<FileLoadIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the label with the formatted size when active", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    render(<FileLoadIndicator />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/largeFile\.opening\|size=1\.4 MB/)).toBeInTheDocument();
  });

  it("exposes aria-live=polite for screen readers", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    render(<FileLoadIndicator />);

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("disappears when endLoad is called", () => {
    useFileLoadStore.getState().startLoad("huge.md", 1_500_000);
    const { rerender, container } = render(<FileLoadIndicator />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    useFileLoadStore.getState().endLoad();
    rerender(<FileLoadIndicator />);
    expect(container).toBeEmptyDOMElement();
  });
});
