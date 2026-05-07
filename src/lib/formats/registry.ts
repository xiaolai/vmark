// WI-1A.2 — Format registry singleton.
//
// Plan reference: dev-docs/plans/20260506-multi-format-rebrand.md
// § Format registry contract.
//
// dispatchEditor(filePath) is the single source of truth for "what does
// this tab do." Markdown is the default for null paths (untitled);
// plain-text is the fallback for unknown extensions when registered.

import type { FormatConfig } from "./types";

const formats: FormatConfig[] = [];
const byId = new Map<string, FormatConfig>();
const byExt = new Map<string, FormatConfig>();

const ID_PATTERN = /^[a-z0-9-]+$/;
const ALWAYS_KEEP_ALIVE_ALLOW_LIST = new Set(["yaml-gha-workflow"]);

const MARKDOWN_FALLBACK_ID = "markdown";
const PLAIN_TEXT_FALLBACK_ID = "txt";

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
  // Invariant 4 (per plan rev 5): non-wysiwyg formats may omit
  // loadLanguage. They render with raw CodeMirror — full editing,
  // find, undo, save still work. The original strict invariant is
  // documented in the plan but consciously relaxed here so Phase 1A
  // stubs and plain `.txt` register without scaffolding fake language
  // packs. wysiwyg formats may NOT declare loadLanguage — they don't
  // mount CodeMirror at all.
  if (config.kind === "wysiwyg" && config.loadLanguage) {
    throw new Error(
      `[formats] "${config.id}" kind=wysiwyg must not declare loadLanguage (CodeMirror is not mounted in WYSIWYG)`,
    );
  }
  if (
    config.adapters.readOnlyDefault === true &&
    config.adapters.closeSavePolicy !== "markdown-default"
  ) {
    throw new Error(
      `[formats] "${config.id}" readOnlyDefault=true requires closeSavePolicy="markdown-default" — editingEnabled=true makes it dirty-capable, save flow must exist`,
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

export function dispatchEditor(filePath: string | null): FormatConfig {
  if (filePath == null) {
    return (
      byId.get(MARKDOWN_FALLBACK_ID) ??
      byId.get(PLAIN_TEXT_FALLBACK_ID) ??
      requireFirst()
    );
  }
  const ext = extractExtension(filePath);
  if (ext) {
    const hit = byExt.get(ext);
    if (hit) return hit;
  }
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

function extractExtension(filePath: string): string | null {
  const slash = filePath.lastIndexOf("/");
  const base = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  // Strip query string and fragment so file:// URLs and tab-restore
  // paths with `?reload=1` / `#anchor` still match.
  const stripped = base.replace(/[?#].*$/, "");
  const dot = stripped.lastIndexOf(".");
  if (dot <= 0 || dot === stripped.length - 1) return null;
  return stripped.slice(dot + 1).toLowerCase();
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
