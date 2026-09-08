// WI-1A.2 — Format registry singleton.
//
// Plan reference: dev-docs/plans/20260506-multi-format-rebrand.md
// § Format registry contract.
//
// dispatchEditor(filePath) is the single source of truth for "what does
// this tab do." Markdown is the default for null paths (untitled);
// plain-text is the fallback for unknown extensions — REQUIRED for a pathed
// file, never markdown (#404). A registered config is frozen with its
// extensions normalized in place, so the indexes cannot drift from it (#403).

import { formatLookupKeys, formatExtensionKey, associationKey } from "./formatPathKeys";
import { freezeFormatConfig, validateFormatConfig } from "./formatValidation";
import type { FormatConfig } from "./types";

/**
 * The registry's whole state, in ONE object so it can be swapped atomically.
 *
 * `rebootstrapFormats` used to clear the live maps and then re-register into
 * them, so an adapter combination that only a settings toggle can produce —
 * two optional formats claiming one extension, say — left the registry half
 * built with no way back (audit R3 #801). `replaceRegistry` builds into a fresh
 * state and installs it only once the rebuild has completed.
 */
interface RegistryState {
  formats: FormatConfig[];
  byId: Map<string, FormatConfig>;
  byExt: Map<string, FormatConfig>;
  /** `listFormats`'s frozen view of `formats`; dropped whenever it changes. */
  snapshot: readonly FormatConfig[] | null;
}

function emptyState(): RegistryState {
  return { formats: [], byId: new Map(), byExt: new Map(), snapshot: null };
}

let state: RegistryState = emptyState();

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

/**
 * Register a format. Validation and freezing are pure and live in
 * `formatValidation.ts`; what remains here is the COMMIT — four writes that
 * happen together or not at all, because nothing above them can throw.
 */
export function registerFormat(config: FormatConfig): void {
  const normalizedExts = validateFormatConfig(config, {
    hasId: (id) => state.byId.has(id),
    extensionOwner: (ext) => state.byExt.get(ext)?.id,
  });
  freezeFormatConfig(config, normalizedExts);

  state.formats.push(config);
  state.snapshot = null;
  state.byId.set(config.id, config);
  for (const ext of normalizedExts) state.byExt.set(ext, config);
}

/**
 * Rebuild the registry from scratch, atomically: `register` runs against an
 * EMPTY registry, and its result is installed only if it completes. A throw
 * leaves the registry exactly as it was, still serving `dispatchEditor`.
 *
 * This is the PRODUCTION entry point for a rebuild (audit R3 #801/#802) —
 * `rebootstrapFormats` runs whenever the user flips a `formats.*` toggle.
 * `__resetRegistry` is once again what its name says: a test-only reset.
 */
export function replaceRegistry(register: () => void): void {
  const previous = state;
  state = emptyState();
  try {
    register();
  } catch (error) {
    state = previous;
    throw error;
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
    // Markdown is the product default for a new document, and `bootstrapFormats`
    // registers it unconditionally — so its absence is a bootstrap defect, not a
    // case to degrade through. Falling back silently opened untitled documents in
    // the plain source pane, or in whatever format happened to register first
    // (audit 20260907 round 2). The pathed branch below already fails this way
    // when `txt` is missing; both are the same defect.
    const markdown = state.byId.get(MARKDOWN_FALLBACK_ID);
    if (!markdown) {
      throw new Error(
        `[formats] dispatchEditor(null): the markdown format "${MARKDOWN_FALLBACK_ID}" ` +
          "is not registered — bootstrapFormats() must run before an untitled " +
          "document is dispatched",
      );
    }
    return markdown;
  }

  const keys = formatLookupKeys(filePath);

  // 1. User association — most-specific key first.
  const associations = associationsProvider();
  for (const key of keys) {
    const assocId = associations[key];
    if (assocId) {
      const cfg = state.byId.get(assocId);
      if (cfg) return cfg;
    }
  }

  // 2. Built-in extension map, keyed by the REAL extension only. The lookup
  //    keys above include the full basename, which made an extensionless file
  //    named `md` or `html` resolve to that format — the "markdown is an
  //    allowlist, not a default" contract broken by a filename (audit round 2).
  const ext = formatExtensionKey(filePath);
  const hit = ext === null ? undefined : state.byExt.get(ext);
  if (hit) return hit;

  // 3. Plain-text fallback — never the markdown editor for a pathed file. The
  //    txt format missing is a bootstrap defect (`bootstrapFormats` registers
  //    markdown/txt/yaml unconditionally), and it fails loudly rather than
  //    granting an unknown file the WYSIWYG markdown editor (#404).
  const plainText = state.byId.get(PLAIN_TEXT_FALLBACK_ID);
  if (!plainText) {
    throw new Error(
      `[formats] dispatchEditor(${JSON.stringify(filePath)}): the plain-text ` +
        `fallback "${PLAIN_TEXT_FALLBACK_ID}" is not registered — ` +
        "bootstrapFormats() must run before a pathed file is dispatched",
    );
  }
  return plainText;
}

export function getFormatById(id: string): FormatConfig | undefined {
  return state.byId.get(id);
}

/**
 * Every registered format, in registration order.
 *
 * A FROZEN snapshot, not the live array: `readonly` is a compile-time claim
 * only, so a caller could sort or splice the registry's own list and desync it
 * from `byId`/`byExt` (audit R2, #800). Cached until the next registration, so
 * repeat callers keep getting the same identity rather than a fresh array per
 * call.
 */
export function listFormats(): readonly FormatConfig[] {
  state.snapshot ??= Object.freeze([...state.formats]);
  return state.snapshot;
}

export function getSupportedExtensions(): readonly string[] {
  // Insertion-order traversal preserves registration order (Map guarantee).
  return [...state.byExt.keys()];
}

/**
 * Clear every registered format. TEST-ONLY, and the name is accurate again:
 * production rebuilds go through `replaceRegistry`, which is atomic. A bare
 * reset leaves the registry empty, so the very next `dispatchEditor` throws
 * until something re-registers — fine between tests, never in a running app.
 */
export function __resetRegistry(): void {
  state = emptyState();
}


export { formatLookupKeys, associationKey };
