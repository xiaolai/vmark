// WI-1A.2 — Format registry singleton.
//
// Plan reference: dev-docs/plans/20260506-multi-format-rebrand.md
// § Format registry contract.
//
// dispatchEditor(filePath) is the single source of truth for "what does
// this tab do." Markdown is the default for null paths (untitled);
// plain-text is the fallback for unknown extensions when registered.

import { formatLookupKeys, associationKey } from "./formatPathKeys";
import type { FormatConfig } from "./types";

const formats: FormatConfig[] = [];
const byId = new Map<string, FormatConfig>();
const byExt = new Map<string, FormatConfig>();

const ID_PATTERN = /^[a-z0-9-]+$/;
const ALWAYS_KEEP_ALIVE_ALLOW_LIST = new Set(["yaml-gha-workflow"]);

const MARKDOWN_FALLBACK_ID = "markdown";
const PLAIN_TEXT_FALLBACK_ID = "txt";

/**
 * User format associations: lookup-key → formatId. The escape hatch for
 * "open this file type as X" (e.g. render a `.txt` as markdown, or force
 * a misdetected file to plain text). Injected by the settings layer via
 * `setFormatAssociationsProvider` so the registry stays a pure leaf with
 * no store import. Defaults to an empty map, which keeps `dispatchEditor`
 * fully deterministic in tests.
 *
 * @coordinates-with services/formats/formatSettingsBridge.ts — installs the provider
 */
let associationsProvider: () => Record<string, string> = () => ({});

/** Install the source of user format associations (settings → registry). */
export function setFormatAssociationsProvider(
  provider: () => Record<string, string>,
): void {
  associationsProvider = provider;
}

/** Reset the associations provider to the empty default. Test-only. */
export function __resetFormatAssociationsProvider(): void {
  associationsProvider = () => ({});
}

export function registerFormat(config: FormatConfig): void {
  if (!config.id || !ID_PATTERN.test(config.id)) {
    throw new Error(
      `[formats] invalid id "${config.id}" — must match ${ID_PATTERN}`,
    );
  }
  if (byId.has(config.id)) {
    throw new Error(`[formats] duplicate id "${config.id}"`);
  }
  if (!Array.isArray(config.extensions) || config.extensions.length === 0) {
    throw new Error(
      `[formats] "${config.id}" must declare at least one extension`,
    );
  }
  // Normalize once; downstream lookups use lowercase, dot-less keys.
  // Pre-flight all entries before mutating either map so a partial
  // registration can't leave the registry in a half-applied state.
  const normalizedExts: string[] = [];
  const seenLocal = new Set<string>();
  for (const raw of config.extensions) {
    if (typeof raw !== "string") {
      throw new Error(
        `[formats] "${config.id}" extension must be a string, got ${typeof raw}`,
      );
    }
    const ext = raw.trim().replace(/^\.+/, "").toLowerCase();
    if (ext.length === 0) {
      throw new Error(
        `[formats] "${config.id}" extension must be non-empty after trim/strip-dot`,
      );
    }
    if (seenLocal.has(ext)) {
      throw new Error(
        `[formats] "${config.id}" declares ".${ext}" more than once`,
      );
    }
    seenLocal.add(ext);
    if (byExt.has(ext)) {
      throw new Error(
        `[formats] extension collision: ".${ext}" already registered by "${
          byExt.get(ext)!.id
        }"`,
      );
    }
    normalizedExts.push(ext);
  }
  if (config.kind === "wysiwyg" && !config.wysiwygComponent) {
    throw new Error(
      `[formats] "${config.id}" kind=wysiwyg requires wysiwygComponent`,
    );
  }
  // WI-13 — surfaces are IMPORT THUNKS, and that has to fail at composition
  // rather than at first mount. A non-callable value here means either a
  // half-written adapter or the pre-WI-13 shape (an already-imported
  // component), and the second one silently reinstates the static import this
  // change removed: everything would still render, and the ~900 kB WYSIWYG
  // chunk would be back on the cold start of every Settings window with no
  // test failing. Callability is all that is checkable — a thunk and a
  // function component are indistinguishable by inspection, and CALLING it
  // here would defeat the point of the field being lazy.
  for (const surface of ["wysiwygComponent", "language"] as const) {
    const value = config[surface];
    if (value !== undefined && typeof value !== "function") {
      throw new Error(
        `[formats] "${config.id}" ${surface} must be an import thunk ` +
          `(() => import(...)), got ${typeof value}`,
      );
    }
  }
  // Invariant 4 (per plan rev 5): non-wysiwyg formats may omit
  // loadLanguage. They render with raw CodeMirror — full editing,
  // find, undo, save still work. The original strict invariant is
  // documented in the plan but consciously relaxed here so Phase 1A
  // stubs and plain `.txt` register without scaffolding fake language
  // packs. wysiwyg formats may NOT declare loadLanguage — they don't
  // mount CodeMirror at all.
  // A wysiwyg format MUST bring its own surface. Editor.tsx used to fall back to
  // MarkdownEditorSurface, so a format declaring kind=wysiwyg without a component
  // silently rendered AS MARKDOWN — failing open into the very privilege Phase 4B
  // removes. A missing surface is a registration bug, so it fails loudly (WI-4.5).
  if (config.kind === "wysiwyg" && !config.wysiwygComponent) {
    throw new Error(
      `[formats] "${config.id}" kind=wysiwyg must declare wysiwygComponent — ` +
        "there is no default surface; falling back to markdown would silently " +
        "render another format as markdown",
    );
  }
  if (config.kind === "wysiwyg" && config.loadLanguage) {
    throw new Error(
      `[formats] "${config.id}" kind=wysiwyg must not declare loadLanguage (CodeMirror is not mounted in WYSIWYG)`,
    );
  }
  // kind:"media" is never editable (no editingEnabled toggle, no text), so the
  // "read-only can still be toggled dirty" rationale below does not apply.
  if (
    config.kind !== "media" &&
    config.adapters.readOnlyDefault === true &&
    config.adapters.closeSavePolicy !== "prompt-on-close"
  ) {
    throw new Error(
      `[formats] "${config.id}" readOnlyDefault=true requires closeSavePolicy="prompt-on-close" — editingEnabled=true makes it dirty-capable, save flow must exist`,
    );
  }
  if (
    config.adapters.sidePanelKeepAlive === "always-when-registered" &&
    !ALWAYS_KEEP_ALIVE_ALLOW_LIST.has(config.id)
  ) {
    throw new Error(
      `[formats] "${config.id}" sidePanelKeepAlive="always-when-registered" not in allow-list ${[
        ...ALWAYS_KEEP_ALIVE_ALLOW_LIST,
      ]
        .map((id) => `"${id}"`)
        .join(", ")}`,
    );
  }

  formats.push(config);
  byId.set(config.id, config);
  for (const ext of normalizedExts) {
    byExt.set(ext, config);
  }
}

/**
 * Resolve a file path to its editor format. The contract (ADR: "markdown
 * is an allowlist, not a default"):
 *
 *   1. Untitled (null path) → markdown — the product default for new docs.
 *   2. A user association wins over everything, matched most-specific key
 *      first (full filename, then dotfile stem, then bare extension). This
 *      is the manual override: "open `.txt` as markdown", "force this as
 *      plain text".
 *   3. The built-in extension map. Markdown only ever matches here via its
 *      own registered `.md`-family extensions, so a non-markdown file can
 *      never resolve to the WYSIWYG markdown editor by accident.
 *   4. Fallback: plain text. NEVER markdown for a file that has a real path
 *      — an unrecognized file (`.env.local`, `Dockerfile`, `.gitignore`)
 *      opens in the plain source pane, not the markdown editor.
 */
export function dispatchEditor(filePath: string | null): FormatConfig {
  if (filePath == null) {
    return (
      byId.get(MARKDOWN_FALLBACK_ID) ??
      byId.get(PLAIN_TEXT_FALLBACK_ID) ??
      requireFirst()
    );
  }

  const keys = formatLookupKeys(filePath);

  // 1. User association — most-specific key first.
  const associations = associationsProvider();
  for (const key of keys) {
    const assocId = associations[key];
    if (assocId) {
      const cfg = byId.get(assocId);
      if (cfg) return cfg;
    }
  }

  // 2. Built-in extension map (markdown only via its own .md-family keys).
  for (const key of keys) {
    const hit = byExt.get(key);
    if (hit) return hit;
  }

  // 3. Plain-text fallback — never the markdown editor for a pathed file.
  return (
    byId.get(PLAIN_TEXT_FALLBACK_ID) ??
    byId.get(MARKDOWN_FALLBACK_ID) ??
    requireFirst()
  );
}

export function getFormatById(id: string): FormatConfig | undefined {
  return byId.get(id);
}

export function listFormats(): readonly FormatConfig[] {
  return formats;
}

export function getSupportedExtensions(): readonly string[] {
  // Insertion-order traversal preserves registration order (Map guarantee).
  return [...byExt.keys()];
}

/**
 * Clear every registered format. The `__` prefix is historical (this
 * was test-only when first introduced) — production now also calls it
 * via `rebootstrapFormats()` whenever the user flips a `formats.*`
 * settings toggle. Safe to invoke at runtime: callers must immediately
 * re-bootstrap via `bootstrapFormats(toggles)` so the always-on trio
 * (markdown / txt / yaml) re-registers before the next dispatch.
 */
export function __resetRegistry(): void {
  formats.length = 0;
  byId.clear();
  byExt.clear();
}


function requireFirst(): FormatConfig {
  const first = formats[0];
  if (!first) {
    throw new Error(
      "[formats] dispatchEditor called before any format was registered",
    );
  }
  return first;
}

export { formatLookupKeys, associationKey };
