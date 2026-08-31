import { CopyPlus, FileStack } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { switchWorkspaceInstance } from "@/services/workspaces/switchWorkspaceInstance";
import { disambiguateWorkspaceDisplayNames } from "@/utils/workspaceIdentity";
import { workspaceRailGlyphs } from "@/utils/workspaceRailGlyphs";
import {
  handleCloseWorkspace,
  handleDuplicateWorkspace,
  handleMoveWorkspace,
} from "./workspaceRailHandlers";
import {
  WorkspaceRailContextMenu,
  type WorkspaceRailMenuPosition,
} from "./WorkspaceRailContextMenu";
import "./WorkspaceRail.css";

// Defined in the shell layout module (with the maths that consume it) and
// re-exported here so existing importers are unaffected.
export { WORKSPACE_RAIL_WIDTH } from "@/shell/shellChrome";

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
  const [menu, setMenu] = useState<
    { instanceId: string; name: string; position: WorkspaceRailMenuPosition } | null
  >(null);

  // Clear a lingering context menu when the rail is disabled (R3-11) —
  // re-enabling must not resurrect a stale menu over an instance that may be
  // gone. Render-time guarded one-way adjustment, the TerminalPanel latch
  // pattern (an effect cannot run once we return null every render).
  if (!enabled) {
    if (menu) setMenu(null);
    return null;
  }

  const instances = workspaceInstanceIds
    .map((id) => instancesById[id])
    .filter((instance) => instance !== undefined);
  const labels = disambiguateWorkspaceDisplayNames(instances);
  // Identity, not position: the glyph is derived from the workspace NAME, so it
  // survives reordering. The badge it replaces showed `index + 1`, which
  // changed on reorder and told you only what the layout already showed.
  const glyphs = workspaceRailGlyphs(
    instances.map((instance) => ({
      workspaceInstanceId: instance.workspaceInstanceId,
      displayName: instance.displayNameKey
        ? t(instance.displayNameKey)
        : (labels[instance.workspaceInstanceId] ?? instance.displayName),
      kind: instance.kind,
    })),
  );

  return (
    <nav className="workspace-rail" aria-label={t("workspaceRail.label")}>
      <div className="workspace-rail__list" role="list">
        {instances.map((instance) => {
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
                // Stable automation hooks (WI-TS5.1): aria-labels are
                // localized, so E2E selects by these instead. A CONTRACT —
                // renaming them breaks e2e/lib/rail.mjs, not just a unit test.
                data-rail-action="activate"
                data-instance-id={instanceId}
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
                  // WI-3R: the FULL context switch (stash outgoing, restore
                  // incoming tabs/panes, sidebar re-root) — not a raw flip.
                  switchWorkspaceInstance(windowLabel, instanceId)
                }
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({
                    instanceId,
                    name: displayLabel,
                    position: { x: event.clientX, y: event.clientY },
                  });
                }}
              >
                {instance.kind === "loose" ? (
                  <span className="workspace-rail__loose" aria-hidden="true">
                    <FileStack size={14} />
                  </span>
                ) : (
                  // aria-hidden: the button's aria-label already carries the
                  // FULL workspace name, so a screen reader must not announce
                  // the one-letter glyph as well.
                  <span className="workspace-rail__glyph" aria-hidden="true">
                    {glyphs[instanceId]}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="workspace-rail__duplicate"
                data-rail-action="duplicate"
                data-instance-id={instanceId}
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
      {menu && (
        <WorkspaceRailContextMenu
          position={menu.position}
          workspaceName={menu.name}
          onClose={() => setMenu(null)}
          onCloseWorkspace={() => {
            void handleCloseWorkspace(windowLabel, menu.instanceId, t);
          }}
          onDuplicate={() => {
            void handleDuplicateWorkspace(windowLabel, menu.instanceId, t);
          }}
          onMoveToNewWindow={() => {
            void handleMoveWorkspace(windowLabel, menu.instanceId, t);
          }}
        />
      )}
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
