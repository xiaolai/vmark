/**
 * WorkspaceRail — close/move/duplicate handlers with their toast policy.
 *
 * Purpose: the async action handlers the rail's buttons and context menu
 * dispatch. Split from WorkspaceRail.tsx to keep the component under the
 * file-size gate; the toast POLICY (which refusals the user hears about)
 * lives here with the calls it governs.
 *
 * Key decisions:
 *   - Close toasts on `busy` only (R2-12): `cancelled` is the user's own
 *     choice at the dirty prompt, and `missing` means the instance is
 *     already gone — both are silently correct outcomes from the rail.
 *   - `result &&` guards match across handlers — test doubles may resolve
 *     void where the real services always return a result.
 *
 * @coordinates-with WorkspaceRail.tsx — the dispatching component
 * @coordinates-with services/workspaces/closeWorkspaceInstance.ts — close leg
 * @coordinates-with services/workspaces/workspaceWindowActions.ts — move/duplicate
 * @module components/WorkspaceRail/workspaceRailHandlers
 */
import type { useTranslation } from "react-i18next";
import { imeToast as toast } from "@/services/ime/imeToast";
import { cleanupTabState } from "@/services/windowClose/tabCleanup";
import { closeTabsWithDirtyCheck } from "@/services/tabs/tabOperations";
import { closeWorkspaceInstance } from "@/services/workspaces/closeWorkspaceInstance";
import {
  duplicateWorkspaceInstanceToNewWindow,
  moveWorkspaceInstanceToNewWindow,
} from "@/services/workspaces/workspaceWindowActions";
import type { WorkspaceWindowActionResult } from "@/types/workspaceTransfer";
import { workspaceError } from "@/utils/debug";

type Translate = ReturnType<typeof useTranslation>["t"];

// Every call site fires these with `void` (R3-10), so a service REJECTION —
// e.g. the dirty-save dialog plumbing throwing mid-close — would otherwise be
// an unhandled rejection with no user-visible failure. Each handler catches,
// logs, and shows its failure toast.

export async function handleCloseWorkspace(
  windowLabel: string,
  instanceId: string,
  t: Translate,
): Promise<void> {
  try {
    const result = await closeWorkspaceInstance(windowLabel, instanceId, {
      closeTabs: closeTabsWithDirtyCheck,
    });
    if (result && !result.ok && result.reason === "busy") {
      toast.error(t("dialog:toast.workspaceCloseBusy"));
    }
  } catch (error) {
    workspaceError("Workspace close threw:", error);
    toast.error(t("dialog:toast.workspaceCloseFailed"));
  }
}

export async function handleMoveWorkspace(
  windowLabel: string,
  instanceId: string,
  t: Translate,
): Promise<void> {
  try {
    const result = await moveWorkspaceInstanceToNewWindow(windowLabel, instanceId, {
      cleanupTab: cleanupTabState,
    });
    if (result && !result.ok) {
      toast.error(t("dialog:toast.workspaceMoveFailed"));
    }
  } catch (error) {
    workspaceError("Workspace move threw:", error);
    toast.error(t("dialog:toast.workspaceMoveFailed"));
  }
}

export async function handleDuplicateWorkspace(
  windowLabel: string,
  instanceId: string,
  t: Translate,
): Promise<void> {
  try {
    const result = await duplicateWorkspaceInstanceToNewWindow(windowLabel, instanceId);
    if (!result) return;
    if (!result.ok) {
      toast.error(t("dialog:toast.workspaceDuplicateFailed"));
      return;
    }
    const skipped = countSkippedTabs(result);
    if (skipped > 0) {
      toast.message(t("dialog:toast.workspaceDuplicateSkipped", { count: skipped }));
    }
  } catch (error) {
    workspaceError("Workspace duplicate threw:", error);
    toast.error(t("dialog:toast.workspaceDuplicateFailed"));
  }
}

function countSkippedTabs(result: WorkspaceWindowActionResult): number {
  if (!result.ok) return 0;
  return (
    (result.skippedDirtyCount ?? 0)
    + (result.skippedUntitledCount ?? 0)
    + (result.skippedMissingCount ?? 0)
  );
}
