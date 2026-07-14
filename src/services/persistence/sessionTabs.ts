/**
 * Session-tab persistence — versioned records + legacy migration (WI-1.1 / R1).
 *
 * Purpose: the pure translation layer between the live `Tab` union and what is
 * written to a workspace config for session restore. Introduced when a tab
 * stopped being "just a file path": a browser tab has no path, so `lastOpenTabs`
 * (a `string[]` of paths) can no longer describe the full session.
 *
 * Downgrade-safe design (deliberate deviation from "retype lastOpenTabs"):
 *   - `WorkspaceConfig.lastOpenTabs` stays a `string[]` of document paths. An
 *     OLD VMark binary (a real downgrade) keeps reading it and restores its
 *     document tabs, silently ignoring browser tabs — exactly the plan's
 *     "browser tab in a downgraded build is skipped, not a crash". Retyping the
 *     field to an object would instead make the old binary's `Vec<String>`
 *     serde choke on a JSON object.
 *   - A NEW, additive `sessionTabs` field (this module's `SessionTabsV1`) carries
 *     the full ordered list including browser tabs. New builds prefer it and
 *     fall back to migrating `lastOpenTabs` when it is absent (legacy configs).
 *
 * Forward tolerance: records with an unknown `kind`, a malformed shape, or an
 * unknown top-level `version` are skipped (or the whole record ignored) rather
 * than throwing — a config written by a newer build must never crash an older
 * one.
 *
 * @coordinates-with stores/workspaceStore.ts — WorkspaceConfig.sessionTabs field
 * @coordinates-with services/navigation/restoreWorkspaceTabs.ts — restore loop
 * @module services/persistence/sessionTabs
 */

import type { Tab } from "@/stores/tabStoreTypes";
import { workspaceWarn } from "@/utils/debug";
import { canonicalizeBrowserUrl, urlForPersistence } from "@/lib/browser/url";

/** A persisted document tab: only the path is restorable; content is re-read. */
export interface PersistedDocumentTab {
  kind: "document";
  path: string | null;
}

/** A persisted browser tab: URL + title + last scroll. No webview state. */
export interface PersistedBrowserTab {
  kind: "browser";
  url: string;
  title: string;
  scrollY?: number;
}

/** A persisted tab record (discriminated on `kind`). */
export type PersistedTab = PersistedDocumentTab | PersistedBrowserTab;

/** The versioned `sessionTabs` payload written to a workspace config. */
export interface SessionTabsV1 {
  version: 1;
  tabs: PersistedTab[];
}

/** The current session-tabs schema version. */
export const SESSION_TABS_VERSION = 1 as const;

interface MigrateOptions {
  /** When false, browser records are dropped (feature disabled / downgraded). Default true. */
  browserSupported?: boolean;
}

/**
 * A parsed record, a well-formed record this call deliberately drops
 * (`"unsupported"`), or a malformed/unknown one (`"malformed"`).
 *
 * The two rejections are NOT the same: a valid browser record read by a build
 * with browser support off is expected, while a malformed record means the
 * config is corrupt. Collapsing them made every persisted browser tab log an
 * "unrecognized record" warning on each workspace open.
 */
type ParsedRecord = PersistedTab | "unsupported" | "malformed";

/** A persisted scroll offset is usable only when it is finite and non-negative.
 *  JSON turns NaN/Infinity into `null`, so persisting them corrupts the record. */
function isValidScrollY(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Narrow one raw record to a `PersistedTab`, or say why it was rejected. */
function parseRecord(raw: unknown, browserSupported: boolean): ParsedRecord {
  if (raw === null || typeof raw !== "object") return "malformed";
  const rec = raw as Record<string, unknown>;

  if (rec.kind === "document") {
    const { path } = rec;
    // An empty path is not a restorable document (documentPathsOf() rejects it
    // too) — accepting it would push "" into the filesystem restore loop.
    if (path === null || (typeof path === "string" && path !== "")) {
      return { kind: "document", path };
    }
    return "malformed";
  }

  if (rec.kind === "browser") {
    if (!browserSupported) return "unsupported";
    const { url, title, scrollY } = rec;
    if (typeof url !== "string" || url === "") return "malformed";
    // The config on disk is untrusted input: it can be hand-edited or corrupted. A url that
    // is not a navigable web URL — `javascript:`, `file://`, an opaque scheme — must never be
    // turned into a browser tab and navigated. `canonicalizeBrowserUrl` is the same http(s)
    // gate the live browser applies, and it returns null for anything else. (Audit, Medium.)
    const canonical = canonicalizeBrowserUrl(url);
    if (canonical === null) return "malformed";
    const out: PersistedBrowserTab = {
      kind: "browser",
      url: canonical,
      title: typeof title === "string" ? title : canonical,
    };
    if (isValidScrollY(scrollY)) out.scrollY = scrollY;
    return out;
  }

  return "malformed"; // unknown kind — a future record this build doesn't understand
}

/** True when `value` is a well-formed `SessionTabsV1` we can read. */
function isReadableSessionTabs(value: unknown): value is { version: number; tabs: unknown[] } {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "number" && Array.isArray(v.tabs);
}

/**
 * Resolve the ordered list of persisted tabs to restore, from the (possibly
 * absent) new `sessionTabs` field and the legacy `lastOpenTabs` paths.
 *
 * Precedence: a readable current-version `sessionTabs` wins; otherwise fall back
 * to the legacy paths (unknown future versions and structurally invalid payloads
 * both fall back). Individual unknown/malformed records are skipped with a warn.
 */
export function migratePersistedTabs(
  sessionTabs: unknown,
  legacyPaths: readonly string[] | null | undefined,
  options: MigrateOptions = {},
): PersistedTab[] {
  const browserSupported = options.browserSupported ?? true;

  if (isReadableSessionTabs(sessionTabs)) {
    if (sessionTabs.version === SESSION_TABS_VERSION) {
      const out: PersistedTab[] = [];
      for (const raw of sessionTabs.tabs) {
        const parsed = parseRecord(raw, browserSupported);
        if (parsed === "malformed") {
          workspaceWarn("Skipping unrecognized session-tab record:", raw);
        } else if (parsed !== "unsupported") {
          out.push(parsed);
        }
      }
      return out;
    }
    // Unknown future version — cannot interpret its records; fall back to legacy.
    workspaceWarn(`Unknown sessionTabs version ${sessionTabs.version}; using legacy lastOpenTabs.`);
  }

  if (!legacyPaths || legacyPaths.length === 0) return [];
  // `legacyPaths` is read off disk and typed `string[]`, but the file is untrusted: a
  // corrupt config can hold nulls, numbers, or objects. Keep only non-empty strings, or a
  // non-string path would flow into the filesystem restore loop. (Audit, Medium.)
  return legacyPaths
    .filter((path): path is string => typeof path === "string" && path !== "")
    .map((path) => ({ kind: "document", path }));
}

/** Serialize the live tab list into the versioned `sessionTabs` payload. */
export function serializeSessionTabs(tabs: readonly Tab[]): SessionTabsV1 {
  return {
    version: SESSION_TABS_VERSION,
    tabs: tabs.map((tab): PersistedTab => {
      if (tab.kind === "browser") {
        // The URL goes to a cleartext file on disk that outlives this session, so an
        // embedded password does not go with it (audit, High). The username stays — it is
        // part of the destination, not a credential.
        const rec: PersistedBrowserTab = {
          kind: "browser",
          url: urlForPersistence(tab.url),
          title: tab.title,
        };
        if (isValidScrollY(tab.scrollY)) rec.scrollY = tab.scrollY;
        return rec;
      }
      return { kind: "document", path: tab.filePath };
    }),
  };
}

/**
 * The document file paths to restore from a workspace config: reads the new
 * `sessionTabs` field when present (falling back to legacy `lastOpenTabs`), and
 * returns only non-null document paths.
 *
 * Browser records are intentionally skipped here (`browserSupported: false`) —
 * browser-tab restore is wired together with the live browser surface (WI-1.3+)
 * and its feature flag (WI-1.10); until then restoring a browser record would
 * create a tab with no surface. Document restore is unchanged: when `sessionTabs`
 * is present its document paths equal `lastOpenTabs` (both are written together).
 */
export function documentPathsForRestore(config: {
  sessionTabs?: unknown;
  lastOpenTabs?: readonly string[] | null;
}): string[] {
  return migratePersistedTabs(config.sessionTabs, config.lastOpenTabs, {
    browserSupported: false,
  })
    .filter((t): t is PersistedDocumentTab => t.kind === "document")
    .map((t) => t.path)
    .filter((p): p is string => p !== null);
}

/** The document file paths (non-null) of `tabs`, for the legacy `lastOpenTabs`
 *  field that keeps old binaries restoring documents on downgrade. */
export function documentPathsOf(tabs: readonly Tab[]): string[] {
  const paths: string[] = [];
  for (const tab of tabs) {
    if (tab.kind === "document" && tab.filePath) paths.push(tab.filePath);
  }
  return paths;
}
