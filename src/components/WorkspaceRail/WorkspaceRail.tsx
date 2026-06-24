import { CopyPlus, FileStack, Folder } from "lucide-react";
import type { CSSProperties } from "react";
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
          const displayLabel = instance.kind === "loose"
            ? t("workspaceRail.looseFiles")
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
                  if (!sourceId || sourceId === instanceId) return;
                  const currentIds = useWorkspaceInstancesStore
                    .getState()
                    .windows[windowLabel]?.workspaceInstanceIds ?? [];
                  const nextIds = reorderIds(currentIds, sourceId, instanceId);
                  useWorkspaceInstancesStore
                    .getState()
                    .reorderWorkspaceInstances(windowLabel, nextIds);
                }}
                onDragEnd={(event) => {
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
  return (
    clientX <= 0
    || clientY <= 0
    || clientX >= globalThis.innerWidth
    || clientY >= globalThis.innerHeight
  );
}
