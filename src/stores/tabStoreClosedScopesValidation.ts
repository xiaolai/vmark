/**
 * Closed-tab entry validation (split from tabStoreClosedScopes.ts for the
 * file-size gate — R3-2 grew the guard to the full per-kind Tab shape).
 *
 * Purpose: the pure trust boundary for hydrated closed-tab entries. Hydration
 * payloads are EXTERNAL input (hot-exit JSON on disk); an accepted entry is
 * restored verbatim into tabStore on reopen, so acceptance must guarantee the
 * complete required shape per kind and a canonical, navigable URL.
 *
 * @coordinates-with tabStoreClosedScopes.ts — the consuming store
 * @module stores/tabStoreClosedScopesValidation
 */
import { canonicalizeBrowserUrl } from "@/lib/browser/url";
import type { Tab } from "@/stores/tabStoreTypes";
import { BROWSER_SCOPE } from "@/services/workspaces/workspaceOwnershipKernel";

// Defined here (not in the store) so the store→validation import stays
// one-directional — a type-only back-import still counts as a cycle to
// dependency-cruiser. Re-exported from tabStoreClosedScopes.ts for consumers.
export interface ClosedTabEntry {
  tab: Tab;
  /** Monotonic close order across ALL scopes of the app session. */
  closedSeq: number;
}

const AUTOMATION_MODES = new Set(["human", "ai-sandbox", "ai-shared"]);
const PERSIST_POLICIES = new Set(["restore-human", "transient-ai"]);

/**
 * Shape guard for a persisted closed-tab entry (audit R2-F13/F14, tightened
 * by R3-2): a hydrated entry is restored VERBATIM into tabStore on reopen, so
 * it must satisfy the full required `Tab` shape per kind — not merely the
 * fields the original guard sampled. A document needs title/isPinned/formatId
 * plus a string-or-null filePath; a browser entry needs title/isPinned, the
 * enum-valid automationMode/persistPolicy, and a CANONICAL http(s) URL (the
 * same gate the live browser applies), so a hand-edited hot-exit payload can
 * never smuggle `javascript:`/`file://` — or a half-shaped tab — into a later
 * reopen. Kind/scope coherence is enforced at hydrate.
 */
export function isValidClosedEntry(raw: unknown, scopeKey: string): raw is ClosedTabEntry {
  if (typeof raw !== "object" || raw === null) return false;
  const e = raw as {
    tab?: {
      id?: unknown;
      kind?: unknown;
      title?: unknown;
      isPinned?: unknown;
      filePath?: unknown;
      formatId?: unknown;
      url?: unknown;
      automationMode?: unknown;
      persistPolicy?: unknown;
    };
    closedSeq?: unknown;
  };
  if (
    typeof e.closedSeq !== "number" ||
    !Number.isSafeInteger(e.closedSeq) ||
    e.closedSeq < 0 ||
    typeof e.tab !== "object" ||
    e.tab === null ||
    typeof e.tab.id !== "string" ||
    typeof e.tab.title !== "string" ||
    typeof e.tab.isPinned !== "boolean"
  ) {
    return false;
  }
  if (e.tab.kind === "document") {
    // Documents never hydrate into the browser-global scope.
    if (scopeKey === BROWSER_SCOPE) return false;
    return (
      (e.tab.filePath === null || typeof e.tab.filePath === "string") &&
      typeof e.tab.formatId === "string"
    );
  }
  if (e.tab.kind === "browser") {
    // Browser entries ONLY in the browser-global scope, with a safe URL.
    if (scopeKey !== BROWSER_SCOPE) return false;
    return (
      typeof e.tab.automationMode === "string" &&
      AUTOMATION_MODES.has(e.tab.automationMode) &&
      typeof e.tab.persistPolicy === "string" &&
      PERSIST_POLICIES.has(e.tab.persistPolicy) &&
      typeof e.tab.url === "string" &&
      canonicalizeBrowserUrl(e.tab.url) !== null
    );
  }
  return false;
}

/** Canonicalize a browser entry's URL at acceptance (R3-3): reopen must hand
 *  tabStore the same normalized value live creation would, not whatever
 *  spelling the persisted payload carried. Documents pass through untouched. */
export function normalizeAcceptedEntry(entry: ClosedTabEntry): ClosedTabEntry {
  if (entry.tab.kind !== "browser") return entry;
  const canonical = canonicalizeBrowserUrl(entry.tab.url);
  if (canonical === null || canonical === entry.tab.url) return entry;
  return { ...entry, tab: { ...entry.tab, url: canonical } };
}

