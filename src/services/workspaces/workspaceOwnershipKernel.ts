/**
 * Pure workspace ownership kernel (WI-1R).
 *
 * Purpose: THE single partition rule deciding which workspace instance owns
 * each tab in a window. Visibility (tab strip, cycling), the switch
 * coordinator's stash, close, move/duplicate, hot-exit capture, and session
 * persistence all consume this kernel — a second ownership rule anywhere else
 * reintroduces the "two instances collect one tab" bug class.
 *
 * Rules (plan invariants 1-3):
 *   1. Browser tabs are WINDOW-GLOBAL (D1): they belong to `BROWSER_SCOPE`,
 *      never to any instance.
 *   2. Explicit claim wins, resolved across ALL instances of the window; a
 *      corrupt duplicate claim resolves to the first claimant in rail order.
 *   3. Unclaimed document tabs classify by path — most-specific containing
 *      root, else the loose instance, else unowned (defensively visible
 *      everywhere; callers that can create a loose instance should do so
 *      BEFORE partitioning).
 *
 * Argument-pure: no store imports, no feature-flag reads — wrappers gather
 * live state and pass it in. Platform-aware containment via WI-17.1.
 *
 * @coordinates-with workspaceContextOwnership.ts — path classification rule
 * @coordinates-with workspaceTabCollection.ts — tabBelongsToWorkspace wrapper
 * @coordinates-with persistence/hotExit/workspaceInstances.ts — capture
 * @module services/workspaces/workspaceOwnershipKernel
 */
import type { WorkspaceInstanceIdentity } from "@/utils/workspaceIdentity";
import {
  isWithinRootForCompare,
  normalizePathForCompare,
} from "@/utils/paths/pathComparison";
import { getRuntimePlatform, type RuntimePlatform } from "@/utils/platform";

/** Structural tab shape — satisfied by both DocumentTab and BrowserTab. */
export interface KernelTab {
  id: string;
  kind: "document" | "browser";
  filePath?: string | null;
}

type InstanceRecord = WorkspaceInstanceIdentity;

/** Window-global scope key for browser tabs (D1). Not an instance id. */
export const BROWSER_SCOPE = "window:browser" as const;

export interface OwnershipPartition {
  /** scopeKey (instanceId or BROWSER_SCOPE) → tab ids in input order. */
  byScope: Map<string, string[]>;
  /** tabId → scopeKey. Unowned tabs are absent. */
  ownerOf: Map<string, string>;
}

/** An instance's effective kind, with the legacy-record fallback rule. */
export function contextKindOf(instance: InstanceRecord): InstanceRecord["kind"] {
  if (instance.kind) return instance.kind;
  if (instance.rootPath) return "workspace";
  return instance.createdFrom === "placeholder" ? "placeholder" : "loose";
}
const contextKind = contextKindOf;

/**
 * Pure path classification: most-specific containing workspace root, active
 * instance breaking same-root ties, else the loose instance, else null.
 * (The historical `classifyWorkspaceContextForTab` rule, platform-aware.)
 */
export function classifyOwnerInstance(
  filePath: string | null,
  instances: readonly InstanceRecord[],
  activeInstanceId: string | null,
  platform: RuntimePlatform,
): InstanceRecord | null {
  const loose = instances.find((instance) => contextKind(instance) === "loose") ?? null;
  if (!filePath) return loose;

  const matches = instances.filter(
    (instance) =>
      contextKind(instance) === "workspace" &&
      instance.rootPath &&
      isWithinRootForCompare(instance.rootPath, filePath, platform),
  );
  if (matches.length === 0) return loose;

  const longest = Math.max(
    ...matches.map((instance) => normalizePathForCompare(instance.rootPath!, platform).length),
  );
  const mostSpecific = matches.filter(
    (instance) => normalizePathForCompare(instance.rootPath!, platform).length === longest,
  );
  return (
    mostSpecific.find((instance) => instance.workspaceInstanceId === activeInstanceId) ??
    mostSpecific[0] ??
    null
  );
}

/**
 * Partition every tab of a window into exactly one scope. See module header
 * for the rules. Input tab order is preserved within each scope.
 */
export function partitionWindowTabs(
  tabs: readonly KernelTab[],
  instances: readonly InstanceRecord[],
  activeInstanceId: string | null,
  platform: RuntimePlatform = getRuntimePlatform(),
): OwnershipPartition {
  const byScope = new Map<string, string[]>();
  const ownerOf = new Map<string, string>();

  const assign = (tabId: string, scope: string) => {
    if (ownerOf.has(tabId)) return;
    ownerOf.set(tabId, scope);
    const list = byScope.get(scope) ?? [];
    list.push(tabId);
    byScope.set(scope, list);
  };

  // Explicit claims, first claimant in rail order winning duplicates.
  const explicitOwner = new Map<string, string>();
  for (const instance of instances) {
    for (const claimedId of instance.tabIds) {
      if (!explicitOwner.has(claimedId)) {
        explicitOwner.set(claimedId, instance.workspaceInstanceId);
      }
    }
  }

  for (const tab of tabs) {
    if (tab.kind === "browser") {
      assign(tab.id, BROWSER_SCOPE);
      continue;
    }
    const claimed = explicitOwner.get(tab.id);
    if (claimed) {
      assign(tab.id, claimed);
      continue;
    }
    const owner = classifyOwnerInstance(
      tab.filePath ?? null,
      instances,
      activeInstanceId,
      platform,
    );
    if (owner) assign(tab.id, owner.workspaceInstanceId);
    // No owner: leave unowned — defensively visible everywhere.
  }

  return { byScope, ownerOf };
}

/**
 * The tabs a window should RENDER for the active instance: its own document
 * tabs, every browser tab (window-global, D1), and any unowned document tab
 * (a tab must never be invisible under every instance). Rail off returns the
 * input unchanged.
 */
export function visibleTabsForWindow<T extends KernelTab>(
  tabs: readonly T[],
  instances: readonly InstanceRecord[],
  activeInstanceId: string | null,
  railEnabled: boolean,
  platform: RuntimePlatform = getRuntimePlatform(),
): T[] {
  if (!railEnabled) return [...tabs];
  const { ownerOf } = partitionWindowTabs(tabs, instances, activeInstanceId, platform);
  return tabs.filter((tab) => {
    const scope = ownerOf.get(tab.id);
    if (scope === BROWSER_SCOPE) return true;
    if (scope === undefined) return true;
    return scope === activeInstanceId;
  });
}

/**
 * Resolve the tab to activate when `instance` becomes active: its recorded
 * `activeTabId` when that tab is live AND owned by it, else its first owned
 * document tab in full window-tab order (invariant 3), else null.
 */
export function resolveIncomingActiveTab(
  instance: InstanceRecord,
  tabs: readonly KernelTab[],
  instances: readonly InstanceRecord[],
  platform: RuntimePlatform = getRuntimePlatform(),
): string | null {
  const { ownerOf } = partitionWindowTabs(
    tabs,
    instances,
    instance.workspaceInstanceId,
    platform,
  );
  const ownedBy = (tabId: string) => ownerOf.get(tabId) === instance.workspaceInstanceId;

  if (instance.activeTabId && ownedBy(instance.activeTabId)) {
    return instance.activeTabId;
  }
  return tabs.find((tab) => ownedBy(tab.id))?.id ?? null;
}
