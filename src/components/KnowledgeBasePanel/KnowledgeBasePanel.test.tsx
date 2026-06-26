// Phase 5 — KnowledgeBasePanel behavior across lifecycle states.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { useContentServerStore } from "@/stores/contentServerStore";

beforeEach(() => {
  useContentServerStore.getState().reset();
});

function renderPanel(overrides: Partial<Parameters<typeof KnowledgeBasePanel>[0]> = {}) {
  const handlers = {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onOpenInBrowser: vi.fn(),
    onPreviewSlides: vi.fn(),
    onExportSlides: vi.fn(),
    ...overrides,
  };
  render(<KnowledgeBasePanel {...handlers} />);
  return handlers;
}

describe("KnowledgeBasePanel", () => {
  it("shows the empty state with a Start button when stopped", async () => {
    const { onStart } = renderPanel();
    const btn = screen.getByRole("button", { name: /start knowledge base/i });
    await userEvent.click(btn);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows download progress while provisioning", () => {
    useContentServerStore.getState().setProvision({ phase: "downloading", received: 50, total: 200 });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(/25%/);
  });

  it("shows an error with a Retry that restarts", async () => {
    useContentServerStore.getState().setError("checksum mismatch");
    const { onStart } = renderPanel();
    expect(screen.getByRole("alert")).toHaveTextContent(/checksum mismatch/);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("embeds the KB iframe and wires toolbar actions when running", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    const { onStop, onOpenInBrowser } = renderPanel();
    const frame = screen.getByTitle(/knowledge base/i);
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:4321");
    await userEvent.click(screen.getByRole("button", { name: /open in browser/i }));
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onOpenInBrowser).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("wires Slidev preview and export actions when running", async () => {
    useContentServerStore.getState().setRunning("http://127.0.0.1:4321", 4321);
    const { onPreviewSlides, onExportSlides } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /preview slides/i }));
    await userEvent.click(screen.getByRole("button", { name: /export slides/i }));
    expect(onPreviewSlides).toHaveBeenCalledOnce();
    expect(onExportSlides).toHaveBeenCalledOnce();
  });
});
