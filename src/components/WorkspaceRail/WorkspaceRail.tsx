import { CopyPlus, FileStack, Folder } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  duplicateWorkspaceInstanceToNewWindow,
  moveWorkspaceInstanceToNewWindow,
} from "@/services/workspaces/workspaceWindowActions";
import type { WorkspaceWindowActionResult } from "@/types/workspaceTransfer";
import { imeToast as toast } from "@/services/ime/imeToast";
import { cleanupTabState } from "@/hooks/tabCleanup";
import { disambiguateWorkspaceDisplayNames } from "@/utils/workspaceIdentity";
import "./WorkspaceRail.css";

export const WORKSPACE_RAIL_WIDTH = 30;

const EMPTY_IDS: string[] = [];
const WORKSPACE_RAIL_COLORS = [
  "var(--accent-primary)",
  "var(--success-color)",
  "var(--warning-color)",
  "var(--error-color)",
  "var(--strong-color)",
  "var(--emphasis-color)",
] as const;

type WorkspaceRailEntryStyle = CSSProperties & {
  "--workspace-rail-color": string;
};

export function WorkspaceRail({ windowLabel }: { windowLabel: string }) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((state) => state.general.workspaceRailMode);
  const workspaceInstanceIds = useWorkspaceInstancesStore(
    (state) => state.windows[windowLabel]?.workspaceInstanceIds ?? EMPTY_IDS,
  );
  const activeId = useWorkspaceInstancesStore(
    (state) => state.windows[windowLabel]?.activeWorkspaceInstanceId ?? null,
  );
  const instancesById = useWorkspaceInstancesStore((state) => state.instances);
  // Set true by an internal reorder drop so the dragend that immediately
  // follows doesn't ALSO treat the gesture as a move-to-new-window. Reset at
  // the start of each drag and consumed in dragend.
  const droppedInternallyRef = useRef(false);

  if (!enabled) return null;

  const instances = workspaceInstanceIds
    .map((id) => instancesById[id])
    .filter((instance) => instance !== undefined);
  const labels = disambiguateWorkspaceDisplayNames(instances);

  return (
    <nav className="workspace-rail" aria-label={t("workspaceRail.label")}>
      <div className="workspace-rail__list" role="list">
        {instances.map((instance, index) => {
          const label = labels[instance.workspaceInstanceId] ?? instance.displayName;
          // Synthetic instances (loose/placeholder) carry a translation key —
          // prefer it over the stored English fallback so the label is localized.
          const displayLabel = instance.displayNameKey
            ? t(instance.displayNameKey)
            : label;
          const active = instance.workspaceInstanceId === activeId;
          const instanceId = instance.workspaceInstanceId;
          return (
            <div
              className="workspace-rail__entry"
              role="listitem"
              key={instanceId}
              style={workspaceRailEntryStyle(instance.rootId ?? instanceId)}
            >
              <button
                type="button"
                className="workspace-rail__item"
                aria-label={t("workspaceRail.activate", { name: displayLabel })}
                aria-pressed={active}
                title={displayLabel}
                draggable
                onDragStart={(event) => {
                  droppedInternallyRef.current = false;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-vmark-workspace-instance", instanceId);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("application/x-vmark-workspace-instance");
                  if (!sourceId) return;
                  // A drop that landed on a rail entry is an internal reorder —
                  // never a move-to-new-window. Record it so the trailing
                  // dragend suppresses the move even when it drops onto the same
                  // entry (sourceId === instanceId is still an internal drop).
                  droppedInternallyRef.current = true;
                  if (sourceId === instanceId) return;
                  const currentIds = useWorkspaceInstancesStore
                    .getState()
                    .windows[windowLabel]?.workspaceInstanceIds ?? [];
                  const nextIds = reorderIds(currentIds, sourceId, instanceId);
                  useWorkspaceInstancesStore
                    .getState()
                    .reorderWorkspaceInstances(windowLabel, nextIds);
                }}
                onDragEnd={(event) => {
                  // An internal drop already handled this gesture — don't also
                  // move the workspace to a new window.
                  if (droppedInternallyRef.current) {
                    droppedInternallyRef.current = false;
                    return;
                  }
                  // A cancelled drag (Esc, invalid target) reports dropEffect
                  // "none" and often clientX/clientY of 0,0. Treat that as a
                  // no-op, not a move-out.
                  if (event.dataTransfer?.dropEffect === "none") return;
                  if (!isOutsideViewport(event.clientX, event.clientY)) return;
                  void handleMoveWorkspace(windowLabel, instanceId, t);
                }}
                onClick={() =>
                  useWorkspaceInstancesStore
                    .getState()
                    .activateWorkspaceInstance(windowLabel, instanceId)
                }
              >
                {instance.kind === "loose" ? (
                  <span className="workspace-rail__loose" aria-hidden="true">
                    <FileStack size={14} />
                  </span>
                ) : (
                  <span className="workspace-rail__folder" aria-hidden="true">
                    <Folder size={14} />
                    <span className="workspace-rail__index">{index + 1}</span>
                  </span>
                )}
              </button>
              <button
                type="button"
                className="workspace-rail__duplicate"
                aria-label={t("workspaceRail.duplicate", { name: displayLabel })}
                title={t("workspaceRail.duplicate", { name: displayLabel })}
                onClick={() => {
                  void handleDuplicateWorkspace(windowLabel, instanceId, t);
                }}
              >
                <CopyPlus size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function reorderIds(ids: string[], sourceId: string, targetId: string): string[] {
  const fromIndex = ids.indexOf(sourceId);
  const toIndex = ids.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0) return ids;
  const next = [...ids];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function workspaceRailEntryStyle(seed: string): WorkspaceRailEntryStyle {
  return { "--workspace-rail-color": workspaceRailColorForSeed(seed) };
}

function workspaceRailColorForSeed(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return WORKSPACE_RAIL_COLORS[hash % WORKSPACE_RAIL_COLORS.length];
}

async function handleMoveWorkspace(
  windowLabel: string,
  instanceId: string,
  t: ReturnType<typeof useTranslation>["t"],
): Promise<void> {
  const result = await moveWorkspaceInstanceToNewWindow(windowLabel, instanceId, {
    cleanupTab: cleanupTabState,
  });
  if (result && !result.ok) {
    toast.error(t("dialog:toast.workspaceMoveFailed"));
  }
}

async function handleDuplicateWorkspace(
  windowLabel: string,
  instanceId: string,
  t: ReturnType<typeof useTranslation>["t"],
): Promise<void> {
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
}

function countSkippedTabs(result: WorkspaceWindowActionResult): number {
  if (!result.ok) return 0;
  return (
    (result.skippedDirtyCount ?? 0)
    + (result.skippedUntitledCount ?? 0)
    + (result.skippedMissingCount ?? 0)
  );
}

function isOutsideViewport(clientX: number, clientY: number): boolean {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  // (0,0) is the sentinel several browsers report for a cancelled or
  // failed-internal-drop dragend — treat it as a no-op, not a move-out.
  // (The dropEffect === "none" guard in the handler covers the common case;
  // this is defense in depth for browsers that don't set dropEffect.)
  if (clientX === 0 && clientY === 0) return false;
  return (
    clientX < 0
    || clientY < 0
    || clientX >= globalThis.innerWidth
    || clientY >= globalThis.innerHeight
  );
}
