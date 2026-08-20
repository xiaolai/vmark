/**
 * Point the window-scoped persistence at the right key, before anything reads.
 *
 * Extracted from `WindowContext`'s init (~159 lines) because it is a single
 * coherent step with four label-dependent rules, and burying it among listener
 * wiring and transfer claiming made both harder to follow. Ordering inside it
 * is load-bearing and is why it is one function rather than four call sites:
 * the storage key must be chosen BEFORE `rehydrate()`, or the store loads the
 * previous window's workspace.
 *
 * @coordinates-with WindowContext.tsx — sole caller, first step of init
 * @module contexts/prepareWindowStorage
 */
import { useWorkspaceStore } from "@/stores/workspaceStore";
import {
  setCurrentWindowLabel,
  getWorkspaceStorageKey,
  migrateWorkspaceStorage,
  findActiveWorkspaceLabel,
} from "@/services/persistence/workspaceStorage";
import { workspaceWarn } from "@/utils/debug";
import { isLaunchWindow } from "@/utils/windowLabels";

export function prepareWindowStorage(label: string): void {
  // Legacy layout migration is the launch window's job, once per run.
  if (isLaunchWindow(label)) migrateWorkspaceStorage();

  // Must precede rehydrate(): it selects which key gets loaded.
  setCurrentWindowLabel(label);

  // Settings has no workspace of its own — it edits the active document
  // window's, so it reads from that window's key instead.
  if (label === "settings") {
    const sourceLabel = findActiveWorkspaceLabel();
    if (sourceLabel) setCurrentWindowLabel(sourceLabel);
  }

  // A doc-* window must not inherit a stale workspace from a previous window
  // that happened to reuse this label.
  if (label.startsWith("doc-")) localStorage.removeItem(getWorkspaceStorageKey(label));

  void Promise.resolve(useWorkspaceStore.persist.rehydrate()).catch((e) =>
    workspaceWarn("Workspace rehydrate failed:", e));
}
