/**
 * Everything `registerFormat` must decide BEFORE it touches the registry.
 *
 * Purpose: `registerFormat` had grown to ~125 lines of interleaved validation,
 * normalization, freezing and commit, with the same predicate checked twice and
 * one branch therefore unreachable (audit R3 #793/#795). Registration is a
 * transaction; the checks it runs first are not, and they are pure — a config
 * plus two "is this taken?" questions in, a normalized extension list or a
 * throw out. Splitting them makes the commit short enough to read as atomic and
 * makes each rule testable without a registry.
 *
 * @coordinates-with src/lib/formats/registry.ts — the only caller
 * @coordinates-with src/lib/formats/formatPathKeys.ts — the lookup grammar EXTENSION_KEY mirrors
 * @module lib/formats/formatValidation
 */

import type { FormatConfig } from "./types";

const ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * The shape `formatExtensionKey` can actually produce: the text after the LAST
 * dot of a lowercased basename. It therefore contains no dot, no path
 * separator, no `?`/`#` (both are stripped as query/fragment markers) and no
 * whitespace.
 *
 * Registration used to accept anything non-empty after trimming and stripping
 * leading dots (audit R3 #794), so `"tar.gz"`, `"a/b"` and `"md?x"` all
 * registered — and then never matched a single file, because the lookup key for
 * `a.tar.gz` is `gz`. A format that registers and never dispatches is the
 * quietest failure this module can produce; refusing it at composition is loud.
 */
const EXTENSION_KEY = /^[^.\\/?#\s]+$/;

/**
 * Fields whose value is an IMPORT THUNK, checked for callability at
 * registration rather than at first mount.
 *
 * A non-callable value means either a half-written adapter or the pre-WI-13
 * shape (an already-imported component), and the second silently reinstates the
 * static import WI-13 removed: everything still renders and the ~900 kB WYSIWYG
 * chunk is back on every cold start with no test failing. Callability is all
 * that is checkable — a thunk and a function component are indistinguishable by
 * inspection, and CALLING one here would defeat the point of the field being
 * lazy.
 *
 * `loadLanguage` and `loadExtraExtensions` were missing from this list (#796),
 * so a malformed value survived registration and threw at first use — in the
 * editor, on the user's document, rather than at composition.
 */
const THUNK_FIELDS = [
  "wysiwygComponent",
  "language",
  "loadLanguage",
  "loadExtraExtensions",
] as const;

/** What the registry can answer about names already taken. */
export interface RegistryLookup {
  /** The id of the format holding `ext`, or undefined. */
  extensionOwner(ext: string): string | undefined;
  /** Whether `id` is already registered. */
  hasId(id: string): boolean;
}

/**
 * Validate `config` and return its NORMALIZED extensions (lowercase, dot-less),
 * or throw. Touches nothing: the caller commits.
 */
export function validateFormatConfig(
  config: FormatConfig,
  registry: RegistryLookup,
): string[] {
  assertIdentity(config, registry);
  const normalized = normalizeExtensions(config, registry);
  assertSurfaces(config);
  assertAdapterPolicy(config);
  return normalized;
}

function assertIdentity(config: FormatConfig, registry: RegistryLookup): void {
  if (!config.id || !ID_PATTERN.test(config.id)) {
    throw new Error(`[formats] invalid id "${config.id}" — must match ${ID_PATTERN}`);
  }
  if (registry.hasId(config.id)) {
    throw new Error(`[formats] duplicate id "${config.id}"`);
  }
}

/**
 * Normalize every declared extension and check it against the lookup grammar
 * and the extensions already registered.
 *
 * Every entry is checked BEFORE the caller mutates anything, so a partial
 * registration cannot leave the registry half-applied.
 */
function normalizeExtensions(config: FormatConfig, registry: RegistryLookup): string[] {
  if (!Array.isArray(config.extensions) || config.extensions.length === 0) {
    throw new Error(`[formats] "${config.id}" must declare at least one extension`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
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
    if (!EXTENSION_KEY.test(ext)) {
      throw new Error(
        `[formats] "${config.id}" extension ".${ext}" is not a lookup key — an ` +
          "extension is the text after the last dot of a filename, so it may not " +
          "contain a dot, a path separator, a query/fragment marker or whitespace; " +
          "such a format would register and never match a file",
      );
    }
    if (seen.has(ext)) {
      throw new Error(`[formats] "${config.id}" declares ".${ext}" more than once`);
    }
    seen.add(ext);
    const owner = registry.extensionOwner(ext);
    if (owner !== undefined) {
      throw new Error(
        `[formats] extension collision: ".${ext}" already registered by "${owner}"`,
      );
    }
    normalized.push(ext);
  }
  return normalized;
}

/**
 * The surface rules.
 *
 * A wysiwyg format MUST bring its own surface. Editor.tsx used to fall back to
 * MarkdownEditorSurface, so a format declaring kind=wysiwyg without a component
 * silently rendered AS MARKDOWN — failing open into the very privilege Phase 4B
 * removes (WI-4.5). This predicate was checked TWICE, and the second branch was
 * unreachable dead code (#795); the surviving message is the informative one.
 *
 * Invariant 4 (plan rev 5): non-wysiwyg formats MAY omit `loadLanguage` — they
 * render with raw CodeMirror, and full editing, find, undo and save still work.
 * A wysiwyg format may not declare it at all; it never mounts CodeMirror.
 */
function assertSurfaces(config: FormatConfig): void {
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
  for (const field of THUNK_FIELDS) {
    const value = config[field];
    if (value !== undefined && typeof value !== "function") {
      throw new Error(
        `[formats] "${config.id}" ${field} must be an import thunk ` +
          `(() => import(...)), got ${typeof value}`,
      );
    }
  }
}

/**
 * kind:"media" is never editable (no editingEnabled toggle, no text), so the
 * "read-only can still be toggled dirty" rationale does not apply to it.
 */
function assertAdapterPolicy(config: FormatConfig): void {
  if (
    config.kind !== "media" &&
    config.adapters.readOnlyDefault === true &&
    config.adapters.closeSavePolicy !== "prompt-on-close"
  ) {
    throw new Error(
      `[formats] "${config.id}" readOnlyDefault=true requires closeSavePolicy="prompt-on-close" — editingEnabled=true makes it dirty-capable, save flow must exist`,
    );
  }
}

/**
 * Freeze the config so the indexes cannot drift from the object the registry
 * serves back (#403).
 *
 * The extensions are rewritten IN PLACE to their normalized form (a no-op for
 * every adapter, which declares them lowercase and dot-less) — in place rather
 * than into a copy, because adapters and their tests hold the same object the
 * registry hands back. A later write then throws under strict mode instead of
 * silently desynchronizing `formats`, `byId` and `byExt`. Re-freezing a config
 * a previous bootstrap already froze is fine: nothing needs writing.
 *
 * `adapters` is frozen one level down too: it carries the invariant validated
 * above, and a shallow freeze left `readOnlyDefault` writable afterwards — so a
 * config could be made to contradict the check it had already passed (audit R2,
 * #797). Deliberately NOT a recursive freeze: `schemaRenderers` holds React
 * components, and a `React.lazy` one mutates its own `_status` and `_result` as
 * the chunk resolves — freezing those would break the preview it renders.
 */
export function freezeFormatConfig(config: FormatConfig, normalized: string[]): void {
  if (config.extensions.some((raw, i) => raw !== normalized[i])) {
    config.extensions.splice(0, config.extensions.length, ...normalized);
  }
  Object.freeze(config.extensions);
  Object.freeze(config.adapters);
  Object.freeze(config);
}
