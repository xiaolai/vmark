// useDocumentLifecycle — pins the per-document composite: every
// document-level hook mounts once, in the documented order
// (file ops → autosave → drag-drop → external changes → reload guard
// → select-all scope → image-paste toast).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => calls.push("fileOperations"),
}));
vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => calls.push("autoSave"),
}));
vi.mock("@/hooks/useDragDropOpen", () => ({
  useDragDropOpen: () => calls.push("dragDropOpen"),
}));
vi.mock("@/hooks/useExternalFileChanges", () => ({
  useExternalFileChanges: () => calls.push("externalFileChanges"),
}));
vi.mock("@/hooks/useReloadGuard", () => ({
  useReloadGuard: () => calls.push("reloadGuard"),
}));
vi.mock("@/hooks/useSelectAllScope", () => ({
  useSelectAllScope: () => calls.push("selectAllScope"),
}));
vi.mock("@/hooks/useImagePasteToast", () => ({
  useImagePasteToast: () => calls.push("imagePasteToast"),
}));

import { useDocumentLifecycle } from "../useDocumentLifecycle";

beforeEach(() => {
  calls.length = 0;
});

describe("useDocumentLifecycle", () => {
  it("mounts every document hook exactly once, in the documented order", () => {
    renderHook(() => useDocumentLifecycle());
    expect(calls).toEqual([
      "fileOperations",
      "autoSave",
      "dragDropOpen",
      "externalFileChanges",
      "reloadGuard",
      "selectAllScope",
      "imagePasteToast",
    ]);
  });

  it("mounts file operations before autosave (save wiring must exist first)", () => {
    renderHook(() => useDocumentLifecycle());
    expect(calls.indexOf("fileOperations")).toBeLessThan(calls.indexOf("autoSave"));
  });
});
