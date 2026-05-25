/**
 * useDocumentLifecycle — per-document lifecycle composite (T03).
 *
 * Bundles the hooks that own document-level concerns: file ops,
 * autosave, drag-drop, external-change detection, reload guards,
 * select-all scoping, image-paste toast.
 *
 * Order contract (preserved from pre-T03 App.tsx + DocumentWindowHooks):
 *   useFileOperations → useAutoSave → useDragDropOpen
 *   → useExternalFileChanges → useReloadGuard → useSelectAllScope
 *   → useImagePasteToast
 *
 * Mount conditionally — React forbids conditional hook calls, so call
 * this composite from a child component that itself mounts only when
 * `isDocumentWindow` is true (`MainWindowRunners` mirrors that pattern
 * for the main-window-only hook set).
 *
 * @module hooks/lifecycle/useDocumentLifecycle
 */

import { useFileOperations } from "@/hooks/useFileOperations";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useDragDropOpen } from "@/hooks/useDragDropOpen";
import { useExternalFileChanges } from "@/hooks/useExternalFileChanges";
import { useReloadGuard } from "@/hooks/useReloadGuard";
import { useSelectAllScope } from "@/hooks/useSelectAllScope";
import { useImagePasteToast } from "@/hooks/useImagePasteToast";

export function useDocumentLifecycle(): void {
  useFileOperations();
  useAutoSave();
  useDragDropOpen();
  useExternalFileChanges();
  useReloadGuard();
  useSelectAllScope();
  useImagePasteToast();
}
