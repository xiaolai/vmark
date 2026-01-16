/**
 * LinkReferenceDialog - Tests
 *
 * Tests for the reference link insertion dialog component.
 * Covers validation state, keyboard interactions, and form submission.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLinkReferenceDialogStore } from "@/stores/linkReferenceDialogStore";
import { LinkReferenceDialog } from "./LinkReferenceDialog";

describe("LinkReferenceDialog", () => {
  beforeEach(() => {
    useLinkReferenceDialogStore.getState().closeDialog();
  });

  describe("visibility", () => {
    it("renders nothing when closed", () => {
      render(<LinkReferenceDialog />);
      expect(screen.queryByText("Insert Reference Link")).not.toBeInTheDocument();
    });

    it("renders dialog when open", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);
      expect(screen.getByText("Insert Reference Link")).toBeInTheDocument();
    });
  });

  describe("validation state", () => {
    it("Insert button disabled when identifier is empty", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const urlInput = screen.getByPlaceholderText("https://example.com");
      fireEvent.change(urlInput, { target: { value: "https://test.com" } });

      const insertButton = screen.getByRole("button", { name: "Insert" });
      expect(insertButton).toBeDisabled();
    });

    it("Insert button disabled when url is empty", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      fireEvent.change(identifierInput, { target: { value: "test-ref" } });

      const insertButton = screen.getByRole("button", { name: "Insert" });
      expect(insertButton).toBeDisabled();
    });

    it("Insert button enabled when both identifier and url have values", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");

      fireEvent.change(identifierInput, { target: { value: "test-ref" } });
      fireEvent.change(urlInput, { target: { value: "https://test.com" } });

      const insertButton = screen.getByRole("button", { name: "Insert" });
      expect(insertButton).not.toBeDisabled();
    });

    it("Insert button disabled when fields contain only whitespace", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");

      fireEvent.change(identifierInput, { target: { value: "   " } });
      fireEvent.change(urlInput, { target: { value: "   " } });

      const insertButton = screen.getByRole("button", { name: "Insert" });
      expect(insertButton).toBeDisabled();
    });
  });

  describe("form submission", () => {
    it("calls insert callback with trimmed values on submit", async () => {
      const callback = vi.fn();
      useLinkReferenceDialogStore.getState().openDialog("", callback);
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");
      const titleInput = screen.getByPlaceholderText("Link title");

      fireEvent.change(identifierInput, { target: { value: "  my-ref  " } });
      fireEvent.change(urlInput, { target: { value: "  https://test.com  " } });
      fireEvent.change(titleInput, { target: { value: "  My Title  " } });

      const insertButton = screen.getByRole("button", { name: "Insert" });
      await userEvent.click(insertButton);

      expect(callback).toHaveBeenCalledWith("my-ref", "https://test.com", "My Title");
    });

    it("does not call callback when fields are invalid", async () => {
      const callback = vi.fn();
      useLinkReferenceDialogStore.getState().openDialog("", callback);
      render(<LinkReferenceDialog />);

      // Only fill identifier, leave URL empty
      const identifierInput = screen.getByPlaceholderText("my-reference");
      fireEvent.change(identifierInput, { target: { value: "test-ref" } });

      // Try to submit via Enter key
      fireEvent.keyDown(identifierInput, { key: "Enter" });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("keyboard interactions", () => {
    it("closes dialog on Escape key", () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      fireEvent.keyDown(identifierInput, { key: "Escape" });

      expect(screen.queryByText("Insert Reference Link")).not.toBeInTheDocument();
    });

    it("submits form on Enter key when valid", () => {
      const callback = vi.fn();
      useLinkReferenceDialogStore.getState().openDialog("", callback);
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");

      fireEvent.change(identifierInput, { target: { value: "test-ref" } });
      fireEvent.change(urlInput, { target: { value: "https://test.com" } });
      fireEvent.keyDown(urlInput, { key: "Enter" });

      expect(callback).toHaveBeenCalledWith("test-ref", "https://test.com", "");
    });
  });

  describe("initial state", () => {
    it("seeds identifier from selected text", () => {
      useLinkReferenceDialogStore.getState().openDialog("Some Link Text", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      expect(identifierInput).toHaveValue("some-link-text");
    });

    it("converts selected text to kebab-case for identifier", () => {
      useLinkReferenceDialogStore.getState().openDialog("Hello World Example", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      expect(identifierInput).toHaveValue("hello-world-example");
    });
  });

  describe("close behavior", () => {
    it("closes on Cancel button click", async () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      await userEvent.click(cancelButton);

      expect(screen.queryByText("Insert Reference Link")).not.toBeInTheDocument();
    });

    it("closes on overlay click", async () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const overlay = document.querySelector(".link-reference-dialog-overlay");
      expect(overlay).toBeInTheDocument();

      // Click directly on overlay (not the dialog content)
      await userEvent.click(overlay!);

      expect(screen.queryByText("Insert Reference Link")).not.toBeInTheDocument();
    });

    it("closes on close button click", async () => {
      useLinkReferenceDialogStore.getState().openDialog("", vi.fn());
      render(<LinkReferenceDialog />);

      const closeButton = screen.getByTitle("Close");
      await userEvent.click(closeButton);

      expect(screen.queryByText("Insert Reference Link")).not.toBeInTheDocument();
    });
  });

  describe("preview", () => {
    it("shows live preview of reference link syntax", () => {
      useLinkReferenceDialogStore.getState().openDialog("my text", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");

      fireEvent.change(identifierInput, { target: { value: "my-ref" } });
      fireEvent.change(urlInput, { target: { value: "https://example.com" } });

      // Check preview shows correct syntax
      expect(screen.getByText("[my text][my-ref]")).toBeInTheDocument();
      expect(screen.getByText("[my-ref]: https://example.com")).toBeInTheDocument();
    });

    it("shows title in preview when provided", () => {
      useLinkReferenceDialogStore.getState().openDialog("text", vi.fn());
      render(<LinkReferenceDialog />);

      const identifierInput = screen.getByPlaceholderText("my-reference");
      const urlInput = screen.getByPlaceholderText("https://example.com");
      const titleInput = screen.getByPlaceholderText("Link title");

      fireEvent.change(identifierInput, { target: { value: "ref" } });
      fireEvent.change(urlInput, { target: { value: "https://test.com" } });
      fireEvent.change(titleInput, { target: { value: "My Title" } });

      expect(screen.getByText('[ref]: https://test.com "My Title"')).toBeInTheDocument();
    });
  });
});
