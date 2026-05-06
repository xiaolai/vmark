# Multi-Format Workspace + Rebrand — Plain-Text Workspace for Humans and AI

**Status:** Draft — revision 5 (post Codex iteration-4 review)
**Owner:** Xiaolai
**Branch:** `feat/multi-format-workspace` (proposed)
**Created:** 2026-05-06
**Cross-model review:** REQUIRED again on this revision before Phase 1A commits (AI gov rule 6). Prior reviews: Codex thread `019dfac0-963f-73e3-ab74-92b49078993d` (rev1: MAJOR GAPS, rev2: NEEDS REVISION).

## Goal

Reposition VMark from "Markdown Editor" to **"the plain-text workspace where humans and AI collaborate"** by adding first-class support for the artifact formats that both humans and AI naturally read and write: markdown (already), YAML, JSON / JSONL, TOML, plain text, standalone Mermaid (`.mmd`), standalone SVG (`.svg`), HTML, and syntax-highlighted *viewing* of common code formats.

The differentiator is not "open more file types" — every IDE does that. It is **schema-aware previews**: when the file is a known artifact (GitHub Actions workflow, `Cargo.toml`, `package.json`, OpenAPI), VMark renders the *right* view, not a generic JSON tree. The existing GitHub Actions workflow viewer is the template; this plan formalizes that pattern as the architectural norm and *validates the differentiator inside Phase 2*.

## Non-goals

- **Not a code editor.** No LSP, no autocomplete, no refactoring, no debugger, no git gutters.
- **Not "support every plain-text format."** Bounded scope (~14 extensions, listed in Final format surface).
- **No content-sniffing for file-type dispatch.** Extension wins (ADR-7).
- **No HTML script execution.** Sandboxed render only (ADR-4).
- **No print / export / copy-as-HTML for non-markdown formats in v1** (ADR-9).
- **No automatic content-search expansion to non-text-like extensions.** Content search expands to all registered text formats (MARKDOWN, JSON, YAML, TOML, etc.) but does not index code files by default — see WI-1B.13.

## Background — verified state of the codebase (2026-05-06)

Every row below has been ground-truthed against the live tree. File:line citations point to the **definition site**, not test assertions; supplementary call sites are listed when relevant.

| Area | Verified finding | Definition site | Other call sites |
|---|---|---|---|
| Tab dispatch | `tabStore` is file-agnostic; `Editor.tsx` hardcodes Tiptap + CodeMirror mount for *every* file | `src/components/Editor/Editor.tsx:88-100` | — |
| YAML routing bandaid | `maybeForceSourceForYaml(tabId, path)` flags YAML to force source mode before Tiptap parses | `src/utils/yamlOpenRouting.ts:37` | `src/hooks/useFileOpen.ts:88`, `src/hooks/useDragDropOpen.ts:78`, `src/hooks/useFinderFileOpen.ts:88`, `src/hooks/useRecentFilesMenuEvents.ts:108, 128` |
| Open dialog filter | Only `["md", "markdown", "mdown", "mkd", "txt"]` | `src/hooks/useFileOpen.ts:159` | — |
| Drag-drop allow-list | `MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"]` (frontend constant) | `src/utils/dropPaths.ts:10` | `src/stores/contentSearchStore.ts:147` (content search scope), `src/components/Editor/DragOverlay/*` (drop overlay UX) |
| Drag-drop ext check | Hardcoded `[".md", ".markdown", ".txt"]` for drag-enter visual feedback | `src/hooks/useDragDropOpen.ts:126` | toast `onlyMarkdownViaDropDrop` line 154 |
| Save-on-close filter | `MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md"] }]` + hardcoded `.md` extension fallback | `src/hooks/closeSave.ts:66` | lines 132, 137, 259, 263, 354, 358 (filename construction) |
| Save-As default | Hardcoded `${suggestedName}.md` for untitled | `src/hooks/useFileSave.ts:102` | — |
| Untitled tab creation | `createUntitledTab(windowLabel)` — no format parameter | `src/utils/newFile.ts:22-26` | menu:new handler (not enumerated) |
| Rust file-open allow-list | `MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"]`; `has_markdown_extension(&Path) -> bool` | `src-tauri/src/lib.rs:118, 130` | `src-tauri/src/lib.rs:965` is the test assertion enforcing the constant |
| Rust open-window security gate | `validate_openable_path` rejects non-markdown extensions before extending fs scope and creating windows | `src-tauri/src/window_manager.rs:334` | called by `open_file_in_new_window`, `open_workspace_in_new_window` |
| macOS quarantine strip (Rust) | `strip_workspace_quarantine` strips `com.apple.quarantine` xattr from workspace root + **direct `.md` children only** (no recursion, markdown-only by design comment) | `src-tauri/src/quarantine.rs:54-100` | comment at `quarantine.rs:18-19` ("`.md` only: matches the editor's domain") |
| macOS quarantine strip (frontend) | `maybeStripMacQuarantine(rootPath)` invokes the Rust command — markdown-domain framing carried through; user-facing toast strings reference markdown | `src/utils/macQuarantineNotice.ts:63-98` | settings flag `advanced.clearMacQuarantineOnOpen` (`src/stores/settingsTypes.ts:234`); locale strings (`src/locales/en/settings.json:552`, `src/locales/en/dialog.json:95`) |
| Rust workspace content search | Backend already accepts caller-supplied extension list — `search_workspace_content` matches generically | `src-tauri/src/content_search.rs:155, 455` | only frontend scope needs widening |
| CodeMirror lang packs **installed** | `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `@codemirror/language-data` (legacy-modes loader) | `package.json:34` | — |
| YAML parser **installed** | `js-yaml ^4.1.1` | `package.json` | — |
| TOML parser | **Not installed** — Phase 0 picks `smol-toml` or `@iarna/toml` | — | — |
| TOML CodeMirror support | Only via `@codemirror/legacy-modes/mode/toml` (not first-class) | `node_modules/@codemirror/language-data/dist/index.js:882-887` | — |
| Mermaid renderer | Reusable but **not pure** — depends on `document.documentElement.classList`, `getComputedStyle`, mutable module state, transient DOM in `document.body` | `src/plugins/mermaid/index.ts:13-19, 24-39, 100-117, 165-205` | — |
| SVG renderer | Pure | `src/plugins/svg/svgRender.ts:8` | — |
| GHA workflow parser | **GHA-specific** — wraps `@actions/workflow-parser`, hard-validates `on:` and `jobs:` | `src/lib/ghaWorkflow/parser/index.ts:28, 79-91` | — |
| GHA detection | Path heuristic + content shape | `src/lib/ghaWorkflow/detection.ts:10-67` | — |

## ADRs

### ADR-1: Tagline is "the plain-text workspace where humans and AI collaborate"

**Decision:** Adopt this exact tagline.

**Mechanism:** "Plain-text workspace" is concrete and searchable. "Humans and AI collaborate" names the differentiator. The "and" matters — both parties read and write the same plain-text artifacts directly, with no translation layer.

**Confidence:** High.

### ADR-2: Generic `<SplitPaneEditor>` + format registry replaces global mode dispatch and the markdown-only entry-point allow-lists

**Decision:** Introduce `<SplitPaneEditor>` (source slot + preview slot + validator slot) and a format registry (`src/lib/formats/registry.ts`) mapping `extension → FormatConfig`. The registry **replaces** today's:
1. Top-level `sourceMode` / `forcedSourceMode` orchestration in `Editor.tsx`.
2. `useUnifiedMenuCommands` hardcoded markdown menu dispatch.
3. Frontend `MARKDOWN_EXTENSIONS` constant in `dropPaths.ts` → becomes `SUPPORTED_EXTENSIONS`, derived from `listFormats()`.
4. Rust `MARKDOWN_EXTENSIONS` and `has_markdown_extension` in `lib.rs` → becomes `SUPPORTED_EXTENSIONS` and `has_supported_extension`, mirroring the frontend registry via a shared YAML config or a single hardcoded list maintained in lockstep.
5. Rust `validate_openable_path` security gate → expands its allow-list to all registered formats.
6. `closeSave.ts` `MARKDOWN_FILTERS` → derived per-tab from the active format's `saveDialogFilters`.
7. `newFile.ts` `createUntitledTab(windowLabel)` → accepts optional `formatId` (defaults to markdown).

Markdown stays on its current Tiptap WYSIWYG path, registered as `kind: "wysiwyg"`. Editor mount, menu adapter selection, search wiring, side-panel keep-alive, export availability, read-only policy, content-search scope, and reload behavior all key off `FormatConfig`.

**Mechanism:** Without unifying mount with the surrounding orchestration, non-markdown tabs would still be governed by markdown-era global state. The registry is the single source of truth for "what does this tab do."

**Trade-off:** `useLargeFileSessionStore.markForcedSource()` (used today for >5MB files to force source-mode rendering) becomes a markdown-adapter-internal concern. Other formats don't need it because they don't have a WYSIWYG path.

**Confidence:** High. Standard pattern. The cost is concentrated in Phase 1A (substrate refactor, ~2 weeks) and Phase 1B (entry-point migration, ~1.5 weeks).

### ADR-3: Code files are viewer-mode by default

**Decision:** `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rs`, `.go`, `.css`, `.sh`, `.rb`, `.lua` open with CodeMirror syntax highlighting in **read-only mode by default**. A clearly-labeled "Enable editing" toggle promotes to read-write (no LSP, no autocomplete). An "Open in external editor" affordance deep-links to `$EDITOR`.

**Mechanism:** Read-only-default is a pre-commitment device against scope creep into LSP territory.

**`.rb` and `.lua` use `@codemirror/legacy-modes`.** No maintained Lezer-grammar pack exists for either — Phase 0 WI-0.6 audit confirmed legacy-modes is the same path the plan already uses for TOML, `.sh`, and `.bash` (1.6M weekly DL, current commits, MIT, zero CVEs). Quality is "syntax-coloring only," which fits viewer-mode posture.

**Removed from v1 scope:** `.zig` only (no maintained CodeMirror pack of any kind).

**Confidence:** Medium-high.

### ADR-4: HTML preview uses `<iframe sandbox="">` + Tauri webview CSP, NOT `<meta http-equiv>` CSP sandbox

**Decision:** HTML preview renders inside `<iframe sandbox="" srcdoc={content}>` with **empty sandbox allow-list** (no `allow-scripts`, no `allow-same-origin`, no `allow-forms`, no `allow-popups`). The HTML content gets a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` injected — note this CSP governs *resource loading inside the iframe*, NOT sandboxing (the `sandbox` directive is not honored when delivered via `<meta>` per MDN). Sandbox is enforced by the iframe attribute alone.

The Tauri webview's outer CSP (set in `tauri.conf.json` `app.security.csp`) is independent. Phase 0 spike WI-0.4 verifies the inner-iframe sandbox behaves correctly inside a Tauri webview context. Optional content sanitization via `DOMPurify` is defense-in-depth.

**Mechanism:** `iframe sandbox=""` blocks script execution, network requests, form submission, popups, and same-origin access. CSP via `<meta>` blocks remote `<img>`, remote fonts, and any `<script>` elements that somehow get rendered.

**Trade-off:** Users cannot see externally-loaded images, fonts, or remote stylesheets in preview. Acceptable.

**Confidence:** Medium-high. Phase 0 WI-0.4 closes the only unknown.

### ADR-5: Schema-aware previews via `schemaDetector` hook, with deterministic precedence

**Decision:** Format registry entries for data formats accept an optional `schemaDetector(path: string, content: string) => SchemaId | null`.

**Detector precedence rules:**
1. **Path detection wins over content detection.** A `.github/workflows/ci.yml` with malformed YAML routes to the GHA renderer (which renders a degraded view with diagnostics) rather than falling back to a generic tree.
2. **Multiple detector hits resolved by registry order.** Detectors registered earlier win. Order is documented in `registry.ts` with a comment.
3. **Content detection on syntactically invalid content returns `null`.**
4. **Detectors are pure and synchronous.** No I/O; no async.

**Confidence:** Medium-high.

### ADR-6: Rebrand ships only after Phase 2 substrate **and** at least one schema-aware preview lands

**Decision:** Tagline propagation is Phase 6, gated on Phase 2 having shipped (markdown + txt + json + yaml + toml + GHA-via-registry + Cargo.toml dep tree).

**Confidence:** High.

### ADR-7: One file extension, one editor — no content sniffing

**Confidence:** High.

### ADR-8: Validator interface is normalized across all formats

**Decision:** `(content: string, path?: string) => ValidationDiagnostic[]` per § Format registry contract. Single gutter component consumes this shape.

**Confidence:** High.

### ADR-9: Print, export, copy-as-HTML, content-search scope expansion

**Decision (in v1):**
- Print, Export (PDF / HTML / DOCX), Copy-as-HTML: **disabled for non-markdown tabs** (greyed out with tooltip).
- Save As (source bytes): **available for all formats**.
- Content search (Cmd+Shift+F): **expands to all text-like registered formats** (markdown, txt, json, yaml, toml, html, svg, mmd) — but **excludes code-viewer formats by default** (settable via search scope UI per WI-1B.13).

**Confidence:** High.

### ADR-10: Kind change semantics

**Decision:** When a tab's path changes (rename, Save As, reopen) and the new extension maps to a different `FormatConfig`, the editor surface unmounts and the new surface mounts fresh. Document content is preserved as a string; **undo history is reset**, dirty state is preserved, and a one-time toast informs the user.

**Confidence:** High.

### ADR-11: Spike code disposition

**Decision:** Phase 0 spike code in `dev-docs/grills/multi-format/` is **deleted before Phase 1A begins**. If a spike result is to be promoted, it goes through a dedicated WI in Phase 1A, copied (not moved) and reviewed independently.

**Confidence:** High.

### ADR-12: Rust ↔ TS extension list synchronization

**Decision:** The Rust `SUPPORTED_EXTENSIONS` constant in `lib.rs` and the TypeScript registry's exported extension list are synchronized via a manually-maintained mirror with a CI guard. `scripts/check-ext-sync.sh` (NEW) compares the two lists at every PR; mismatch fails CI.

**Mechanism:** Code-generation from a single source (e.g., generating Rust from TS at build time) introduces a build-step dependency. Manual mirror with CI guard is simpler and proven (the project already does this for keyboard shortcuts per `.claude/rules/41-keyboard-shortcuts.md`).

**Confidence:** Medium-high.

## Format registry contract

Concrete TypeScript interfaces. Live in `src/lib/formats/types.ts`.

```ts
import type { Extension } from "@codemirror/state";
import type { ComponentType } from "react";

export type FormatKind =
  | "wysiwyg"      // Tiptap (markdown only in v1)
  | "split-pane"   // CodeMirror source + preview pane
  | "viewer";      // CodeMirror source, read-only by default

/** Normalized diagnostic shape. */
export interface ValidationDiagnostic {
  severity: "error" | "warning" | "info";
  line: number;        // 1-indexed
  column: number;      // 1-indexed
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId?: string;
  sourceUrl?: string;
}

export type Validator = (content: string, path?: string) => ValidationDiagnostic[];

/** Schema detector — pure, synchronous. */
export type SchemaDetector = (path: string, content: string) => string | null;

export interface PreviewRendererProps {
  content: string;
  path: string | null;
  diagnostics: ValidationDiagnostic[];
  onJumpToPosition?: (line: number, column: number) => void;
}
export type PreviewRenderer = ComponentType<PreviewRendererProps>;

/** Per-format adapters covering everything ADR-2 says the registry controls. */
export interface FormatAdapters {
  /** Save-As / Save dialog filters. */
  saveDialogFilters: { name: string; extensions: string[] }[];
  /** Default extension for untitled files of this format. */
  untitledExtension: string;
  /** Whether Print / Export / Copy-as-HTML menu items are enabled. Default false (per ADR-9). */
  exportEnabled?: boolean;
  /** Whether Find-in-document UI is wired up. Default true. */
  findEnabled?: boolean;
  /** Search adapter — which search backend the Find UI dispatches to. */
  searchAdapter: "codemirror" | "tiptap";
  /** Whether content-search (Cmd+Shift+F) indexes this format. Default true for split-pane, false for viewer. */
  contentSearchIndexed?: boolean;
  /** Default read-only state for new tabs of this format. Per ADR-3, code formats are true; data and visual formats are false. */
  readOnlyDefault: boolean;
  /** Reload-on-external-change policy. "reload" = read disk + replace content; "prompt" = ask first. Default "reload" matches markdown today. */
  reloadPolicy?: "reload" | "prompt";
  /** Side-panel adapter (e.g. workflow panel keep-alive logic). Optional; markdown registers no side panel from this hook. */
  sidePanelComponent?: ComponentType<{ tabId: string }>;
  /** Side-panel keep-alive policy. Determines whether the panel mounts when the tab becomes active and stays mounted on tab-switch.
   *  - "lazy-on-demand" (default): mount when tab active, unmount on tab-switch.
   *  - "while-active": same as lazy-on-demand but persists state across remounts via store-backed memoization.
   *  - "always-when-registered": panel stays mounted for every tab of this format regardless of active state. **Use only for low-cost panels.** Heavy panels accumulate hidden DOM and degrade tab-switch p99 — perf bench (WI-1A.10) gates this mode by name. The only v1 user is the GHA workflow side panel, which already pays this cost today.
   */
  sidePanelKeepAlive?: "while-active" | "always-when-registered" | "lazy-on-demand";
  /** Per-format menu enable/disable hints. The registry consults this when building the native menu's enabled state. */
  menuPolicy: {
    sourceWysiwygToggle: boolean; // markdown only
    cjkFormatActions: boolean;    // markdown only
    insertBlockActions: boolean;  // markdown only (insert mermaid, math, table, etc.)
    paragraphFormatting: boolean; // markdown only (heading levels, lists, etc.)
  };
  /** Close-on-dirty save flow.
   *  - "markdown-default" reuses existing closeSave.ts logic — the universal path for any format that supports editing.
   *  - "save-as-only" skips the in-place save attempt (e.g., HTML preview where "save the rendered output" doesn't apply; falls back to Save As of the source bytes).
   *  Removed `"no-save"`: any format that supports editing — including viewer formats with `editingEnabled = true` — must be able to save. The previous v1.x intention "never editable" applies to no v1 format; if added later, it goes through ADR review.
   *  Invariant: a format with `readOnlyDefault: true` MUST set `closeSavePolicy: "markdown-default"` (because `editingEnabled = true` promotes it to dirty-capable; the save flow has to exist).
   */
  closeSavePolicy: "markdown-default" | "save-as-only";
}

export interface FormatConfig {
  /** Stable id, e.g. "markdown", "yaml", "json", "toml", "mermaid", "svg", "html", "code-ts", "code-py", … */
  id: string;
  /** i18n key for the human-readable name (used in tab kind label, dialog titles). */
  nameI18nKey: string;
  /** File extensions (lower-case, no dot). First entry is the canonical default. */
  extensions: string[];
  /** Editor surface kind. */
  kind: FormatKind;
  /** For "wysiwyg": React component to mount. */
  wysiwygComponent?: ComponentType<{ tabId: string }>;
  /** For "split-pane" / "viewer": CodeMirror language extension factory. Lazy. */
  loadLanguage?: () => Promise<Extension>;
  /** Additional CodeMirror extensions specific to this format. */
  loadExtraExtensions?: () => Promise<Extension[]>;
  /** Validator (optional). */
  validator?: Validator;
  /** Generic preview component (optional). */
  genericPreview?: PreviewRenderer;
  /** Schema-aware preview detectors and renderers (optional). */
  schemaDetector?: SchemaDetector;
  schemaRenderers?: Record<string, PreviewRenderer>;
  /** Adapters for surrounding UI / behavior. */
  adapters: FormatAdapters;
}

/** Persisted per-tab metadata extending tabStore. */
export interface TabFormatState {
  formatId: string;
  /** For "viewer" kind: whether the user has opted into editing. */
  editingEnabled?: boolean;
  /** For "split-pane": the active schema id (from detector), null if generic. */
  activeSchemaId?: string | null;
}
```

**Registry singleton** in `src/lib/formats/registry.ts`:

```ts
export function registerFormat(config: FormatConfig): void;
export function dispatchEditor(filePath: string | null): FormatConfig;
export function getFormatById(id: string): FormatConfig | undefined;
export function listFormats(): readonly FormatConfig[];
export function getSupportedExtensions(): readonly string[]; // for dialog filters, drag-drop allow-list, content-search scope
```

**`registerFormat()` runtime invariants** (asserted on registration; throw on violation):

1. `id` is non-empty, unique, and matches `/^[a-z0-9-]+$/`.
2. `extensions` is non-empty and disjoint from every previously-registered format's extensions.
3. If `kind === "wysiwyg"`, then `wysiwygComponent` is defined.
4. If `kind !== "wysiwyg"`, then `loadLanguage` is defined OR the format is plain `.txt` OR the format is a Phase 1A stub (per WI-1A.11). Stubs and plain text render with raw CodeMirror — no syntax highlighting, but full editing/find/undo/save still work.
5. **`adapters.readOnlyDefault === true` ⟹ `adapters.closeSavePolicy === "markdown-default"`** (per § Format registry contract). Asserts in `registerFormat()` so a viewer-format that becomes editable always has a working save flow.
6. `adapters.sidePanelKeepAlive === "always-when-registered"` is permitted only when the format id is in a hardcoded allow-list (`["yaml-gha-workflow"]` for v1) — guards the perf footgun.
7. `schemaRenderers` keys must include every schema id any registered `schemaDetector` can return (verified by spot-checking against detector unit-test fixtures, not statically — but the registry warns if a detector returns an unknown id at runtime).

`dispatchEditor(null)` returns the markdown config. `dispatchEditor("foo.unknown")` returns the plain-text fallback config.

## Tree preview interaction spec

Generic JSON / YAML / TOML tree preview behavior:

| Feature | v1 |
|---|---|
| Collapsible nodes | Yes — click chevron, or arrow keys |
| Keyboard navigation | Up/Down to move, Left/Right to collapse/expand, Enter to jump source to node |
| Selection / highlight | Single-select with focus ring |
| Copy node value to clipboard | Yes (Cmd/Ctrl-C) |
| Source-synced cursor | Click in source → tree highlights matching node (debounced 100ms) |
| Editable | **No** — tree is read-only; users edit the source pane |
| Virtualization | Yes when >500 nodes (using a verified library from WI-0.5) |
| Truncation | Long string values truncated to 200 chars with "..." and tooltip |
| ARIA roles | Container is `role="tree"`; nodes are `role="treeitem"` with `aria-level`, `aria-expanded`, `aria-selected` |
| Screen reader announcements | `aria-live="polite"` region announces selection ("foo: 42, string"), expand ("expanded, 5 children"), collapse ("collapsed") |
| Focus management | Selection follows focus; Tab leaves the tree to source pane |

**Library:** `react-json-view-lite` v2.5.0 (Phase 0 WI-0.5 CLOSED). Mechanism: only candidate with documented keyboard navigation + ARIA labelling per `33-focus-indicators.md`.

## Final format surface

Verified language pack support, tiered:

| Extension | Kind | CodeMirror lang pack | Tier | Preview | Validator | Schema detectors |
|---|---|---|---|---|---|---|
| `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` | wysiwyg | `@codemirror/lang-markdown` (installed) | OFFICIAL | Tiptap WYSIWYG | existing markdown lint | — |
| `.txt` | split-pane | none | N/A | none | — | — |
| `.json`, `.jsonl` | split-pane | `@codemirror/lang-json` (NEW) | OFFICIAL | tree | `JSON.parse` | `package-json` (5.1) |
| `.yaml`, `.yml` | split-pane | `@codemirror/lang-yaml` (installed) | OFFICIAL | tree | `js-yaml` | `gha-workflow` (2.4) |
| `.toml` | split-pane | `legacy-modes/mode/toml` via `@codemirror/language-data` | LEGACY | tree | `smol-toml` (NEW, eval Phase 0) | `cargo-toml` (2.5), `pyproject-toml` (5.2) |
| `.mmd` | split-pane | `codemirror-lang-mermaid` (NEW, COMMUNITY) | COMMUNITY | mermaid render (existing renderer, wrapped per WI-3.1) | Langium parser (existing) | — |
| `.svg` | split-pane | `@codemirror/lang-xml` (NEW) | OFFICIAL | inline SVG render (existing) | XML well-formedness (existing) | — |
| `.html`, `.htm` | split-pane | `@codemirror/lang-html` (NEW) | OFFICIAL | sandboxed iframe (ADR-4) | HTML5 parser warnings | — |
| `.ts`, `.tsx`, `.js`, `.jsx` | viewer | `@codemirror/lang-javascript` (NEW) | OFFICIAL | none | — | — |
| `.py` | viewer | `@codemirror/lang-python` (NEW) | OFFICIAL | none | — | — |
| `.rs` | viewer | `@codemirror/lang-rust` (NEW) | OFFICIAL | none | — | — |
| `.go` | viewer | `@codemirror/lang-go` (NEW) | OFFICIAL | none | — | — |
| `.css` | viewer | `@codemirror/lang-css` (NEW) | OFFICIAL | none | — | — |
| `.sh`, `.bash` | viewer | `legacy-modes/mode/shell` via `@codemirror/language-data` | LEGACY | none | — | — |
| `.rb` | viewer | `legacy-modes/mode/ruby` via `@codemirror/language-data` | LEGACY | none | — | — |
| `.lua` | viewer | `legacy-modes/mode/lua` via `@codemirror/language-data` | LEGACY | none | — | — |

**Removed from v1 scope:** `.zig` only (no maintained CodeMirror pack of any kind). Phase 0 WI-0.6 audit confirmed `.rb` and `.lua` are reachable via `@codemirror/legacy-modes`, so they ship in v1 per ADR-3.

**New npm dependencies:**

| Package | Tier | Notes |
|---|---|---|
| `@codemirror/lang-json` | OFFICIAL | |
| `@codemirror/lang-html` | OFFICIAL | |
| `@codemirror/lang-xml` | OFFICIAL | |
| `@codemirror/lang-css` | OFFICIAL | |
| `@codemirror/lang-javascript` | OFFICIAL | |
| `@codemirror/lang-python` | OFFICIAL | |
| `@codemirror/lang-rust` | OFFICIAL | |
| `@codemirror/lang-go` | OFFICIAL | |
| `smol-toml` (>=1.6.1) | OFFICIAL | Phase 0 WI-0.6 picked over `@iarna/toml` — actively maintained, prior CVEs all fixed in 1.6.1. Wrap parse/stringify in try/catch when reading user files. |
| `codemirror-lang-mermaid` (pin =0.5.0) | COMMUNITY | Phase 0 WI-0.6: SUFFICIENT-FALLBACK — last commit 2023-09-14, but 90k weekly DL, no CVEs, MIT. Mermaid grammar evolves slowly; pin exact version. v1.x backlog: replace if upstream remains dormant past 2026-09. |
| `react-json-view-lite` (>=2.5.0) | OFFICIAL | Phase 0 WI-0.5 picked over `@uiw/react-json-view` and `react-json-tree` — only candidate with documented keyboard navigation + ARIA labelling, required by `33-focus-indicators.md` accessibility rules. |
| `dompurify` (>=3.4.2) | OFFICIAL | Defense-in-depth for HTML preview. Pin >=3.4.2 to avoid CVE-2025-15599 and CVE-2026-0540. |
| `@codemirror/legacy-modes` (>=6.5.2) | OFFICIAL | Substrate for TOML, Shell, Ruby, Lua syntax via `StreamLanguage.define()`. Already pulled in via existing `@codemirror/language-data` dep. |

Each subject to `scripts/check-new-deps.sh` per AI gov rule 4.

## Phase plan

### Phase 0 — Architecture spikes (estimate: 3-5 days)

All spike code lives in `dev-docs/grills/multi-format/` and is **deleted before Phase 1A** (ADR-11).

- **WI-0.1** — `<SplitPaneEditor>` shape spike. Verify CodeMirror loads `@codemirror/lang-json`, renders source + tree.
- **WI-0.2** — Format registry shape spike. Verify `dispatchEditor()` routes correctly.
- **WI-0.3** — Validator-to-gutter spike. CodeMirror linter accepts non-CM diagnostics.
- **WI-0.4** — HTML iframe sandbox spike inside Tauri webview. Test `<iframe sandbox="" srcdoc={…}>` against OWASP XSS payloads (top 20).
- **WI-0.5** — Tree preview library audit. Pick one, write rationale.
- **WI-0.6** — Community pack maintenance audit. Verify `codemirror-lang-mermaid`, TOML parser, and `.rb`/`.lua` packs against AI gov rule 4 thresholds (>1000 weekly downloads, last commit <12 months, no critical CVEs).
- **WI-0.7** — `Editor.tsx` surface refactor risk audit. Read every site that mounts or coordinates with `Editor`. Enumerate which pieces of `useUnifiedMenuCommands`, `sourceMode` switches, `forcedSourceMode` markers, side-panel keep-alive, search wiring, large-file routing, and content-search scope must move into format adapters. Output: `dev-docs/grills/multi-format/refactor-audit.md` with site list.

**DoD:** All 7 spikes runnable; findings in `dev-docs/grills/multi-format/findings.md`. Any REFUTED assumption blocks Phase 1A. DoD script `bash scripts/check-multi-format-phase.sh 0` exits 0.

### Phase 1A — Registry substrate + Editor.tsx surface refactor + stub format registrations (estimate: 2 weeks)

Markdown behavior is byte-identical to current main at the end of Phase 1A.

- **WI-1A.1** — `src/lib/formats/types.ts` with concrete TS interfaces from § Format registry contract.
- **WI-1A.2** — `src/lib/formats/registry.ts` singleton + `dispatchEditor()` + `getSupportedExtensions()`.
- **WI-1A.3** — Markdown adapter. `src/lib/formats/adapters/markdown.ts` registers `.md` / `.markdown` / `.mdown` / `.mkd` / `.mdx` as `kind: "wysiwyg"` with the existing `<TiptapEditor>`. Markdown's source-mode toggle is a markdown-adapter-internal concern.
- **WI-1A.4** — `<SplitPaneEditor>` skeleton. Source slot + empty preview slot + validator slot.
- **WI-1A.5** — `Editor.tsx` refactor. Replaces hardcoded Tiptap mount with `dispatchEditor(activeTab.filePath)`. Markdown observable behavior unchanged.
- **WI-1A.6** — Migrate `sourceMode` / `forcedSourceMode` orchestration into the markdown adapter; non-markdown tabs bypass these stores.
- **WI-1A.7** — Migrate `useUnifiedMenuCommands` to consult per-format `menuPolicy`. Disable / no-op handlers for non-markdown formats.
- **WI-1A.8** — Normalized `ValidationDiagnostic` type and `<ValidationGutter>` component.
- **WI-1A.9** — Plain `.txt` adapter — full pipeline smoke test.
- **WI-1A.10** — `<SplitPaneEditor>` resize handle, theme parity, ARIA roles, focus management.
- **WI-1A.11** — **Stub registrations for all Phase 2-4 formats.** Each format from the Final format surface table is registered with **`extensions`, `kind`, `nameI18nKey`, and minimum `adapters`** (`saveDialogFilters`, `untitledExtension`, `searchAdapter`, `readOnlyDefault`, `closeSavePolicy`, `menuPolicy`). `loadLanguage`, `validator`, `genericPreview`, `schemaDetector`, `schemaRenderers`, and `wysiwygComponent` are not yet implemented. Rationale: Phase 1B's entry-point work depends on `getSupportedExtensions()` returning the full set; if Phase 1A only registers markdown + txt, opening `.json` from Finder would still be rejected. Stubs enable correct routing while later phases land the actual implementations. A stub-registered format opens with raw CodeMirror (no language pack, no preview, no validator) — functional fallback, not broken.
- **WI-1A.12** — **Tab kind-change contract (ADR-10).** Adds `Tab.formatId` field derived from path on `createTab` / `createUntitledTab` / `updateTabPath`. When path change yields a different `dispatchEditor()` result, the editor surface unmounts and the new surface mounts fresh — content preserved as string, undo history reset, dirty state preserved, one-time toast informs the user. Moved here from Phase 1B per WI-0.7 refactor-audit "PR 2: Tab store extension" (originally listed as WI-1B.15 — that ID is reused for this purpose; Phase 1B no longer carries a kind-change contract WI).

**Build order (per WI-0.7 refactor-audit risk-tabling — `useUnifiedMenuCommands` is the long pole):**

1. **First:** WI-1A.1 (types) → WI-1A.2 (registry) → WI-1A.3 (markdown adapter declares `menuPolicy`) → WI-1A.12 (tab kind plumbing). Foundation that every other WI depends on.
2. **Second (long pole — start as soon as foundation lands):** WI-1A.7 (`useUnifiedMenuCommands` format routing). Markdown still works because the markdown adapter's `menuPolicy` enables every action; non-markdown tabs no-op.
3. **Parallelizable:** WI-1A.4 + WI-1A.5 + WI-1A.10 (SplitPaneEditor + Editor.tsx refactor + polish), WI-1A.6 (sourceMode → markdown adapter), WI-1A.8 (gutter), WI-1A.9 (txt adapter), WI-1A.11 (stubs).

**Per-WI i18n requirement:** every WI introducing user-visible strings adds `en` keys in `src/locales/en/*.json` in the same commit. Translation to other locales batched in Phase 6.

**DoD:**
- `pnpm test` and `pnpm check:all` pass.
- Opening any `.md` file is byte-identical in editor / menu / search / export behavior to current main (regression-tested with 20+ existing markdown fixtures).
- Opening `foo.txt` mounts `<SplitPaneEditor>` with line numbers + undo + find — no preview pane.
- Opening `foo.json` (stub) mounts `<SplitPaneEditor>` with raw CodeMirror — no language highlighting yet, no preview.
- `git grep markForcedSource` shows calls only inside markdown adapter.
- `getSupportedExtensions()` returns all 14+ planned extensions.
- DoD script `bash scripts/check-multi-format-phase.sh 1A` exits 0.

### Phase 1B — Entry-point and save-path generalization (estimate: 1.5 weeks)

Markdown remains the default for **untitled** files; this phase opens **existing-file** paths to all stub-registered formats.

- **WI-1B.1** — Open dialog filter generalization. `useFileOpen.ts:159` filter expands from markdown-only to "All Supported" (built from `getSupportedExtensions()`) + a "Markdown" preset. Dialog UX preserved.
- **WI-1B.2** — Drag-drop filter generalization. `useDragDropOpen.ts:126, 154` accepts any registered extension. Toast `onlyMarkdownViaDropDrop` replaced with format-agnostic message when no registered extension matches.
- **WI-1B.3** — `src/utils/dropPaths.ts` `MARKDOWN_EXTENSIONS` → `SUPPORTED_EXTENSIONS`, derived from `getSupportedExtensions()`. Old constant removed; tests in `dropPaths.test.ts` updated. (Frontend constant — Codex flagged this as a missing site.)
- **WI-1B.4** — Rust `MARKDOWN_EXTENSIONS` and `has_markdown_extension` in `src-tauri/src/lib.rs:118, 130` rename / expand to `SUPPORTED_EXTENSIONS` / `has_supported_extension`. New CI check `scripts/check-ext-sync.sh` per ADR-12.
- **WI-1B.5** — Rust `validate_openable_path` security gate (`src-tauri/src/window_manager.rs:334`) expands its allow-list to all `SUPPORTED_EXTENSIONS`. Symlink canonicalization preserved. Manual security test: confirm a `.json` symlink to `/etc/passwd` is rejected (extension match still passes — the canonical-path check is what blocks; verify the test suite covers the full extension set).
- **WI-1B.6** — `useFinderFileOpen.ts:88` migration. The `maybeForceSourceForYaml` call is replaced by registry-driven mode dispatch (no-op for non-markdown formats). Cold-start / hot-open / Finder Open With paths generalized.
- **WI-1B.7** — `useRecentFilesMenuEvents.ts:108, 128` migration. Both `maybeForceSourceForYaml` call sites replaced by registry dispatch.
- **WI-1B.8** — `closeSave.ts` markdown-only filters generalized. `MARKDOWN_FILTERS` derived per-tab from `dispatchEditor(tab.filePath).adapters.saveDialogFilters`. Hardcoded `.md` extension fallback (lines 132, 137, 259, 263, 354, 358) consults `untitledExtension` per-tab.
- **WI-1B.9** — `useFileSave.ts:102` Save dialog default filename uses per-tab `untitledExtension` instead of hardcoded `.md`.
- **WI-1B.10** — `newFile.ts` `createUntitledTab(windowLabel, formatId?)` accepts optional `formatId` (defaults to markdown). Internal plumbing only — UI for "New Other Format" is deferred to v1.x.
- **WI-1B.11** — macOS `Open With VMark` document-type expansion. `src-tauri/tauri.conf.json` `bundle.macOS.fileAssociations` includes all registered extensions.
- **WI-1B.12** — CLI argv handling. Verify Rust `lib.rs` argv parsing accepts non-markdown paths and routes through the same registry-driven open path. Existing test in `lib.rs:1052` (loop over `MARKDOWN_EXTENSIONS`) is updated to loop over `SUPPORTED_EXTENSIONS`.
- **WI-1B.13** — `contentSearchStore.ts:147` content-search scope expansion. Scope expands to `getSupportedExtensions()` filtered by `adapters.contentSearchIndexed === true` (default true for split-pane, false for viewer per ADR-9). Settings UI gets a "Search in code files" toggle (deferred to v1.x).
- **WI-1B.14** — `useExternalFileChanges.ts` reload behavior consults `adapters.reloadPolicy`. For markdown: existing behavior preserved; for data formats: reload + revalidate.
- **WI-1B.15** — *(MOVED to WI-1A.12 in revision 5; kept as a placeholder so cross-references stay valid.)* Tab kind-change contract was originally scoped here but landed in Phase 1A per WI-0.7 refactor-audit ordering. No Phase 1B work remains under this id.
- **WI-1B.16** — macOS quarantine flow generalization. Two changes:
  - `src-tauri/src/quarantine.rs:54` `strip_workspace_quarantine(root)` extends from "direct `.md` children only" to "direct children matching `getSupportedExtensions()`-equivalent Rust list" — using the same `SUPPORTED_EXTENSIONS` constant from WI-1B.4. The "markdown-only" comment at `quarantine.rs:18-19` is updated to reflect the new scope.
  - `src/utils/macQuarantineNotice.ts:63-98` `maybeStripMacQuarantine` framing remains identical (Rust does the per-format work); user-facing toast strings are reworded from markdown-specific to format-agnostic in the locale JSON (`src/locales/en/dialog.json:95`, `src/locales/en/settings.json:552`).
  - Settings toggle key `advanced.clearMacQuarantineOnOpen` is unchanged.
  - **Rationale:** Without this, macOS Finder Open With for newly-supported formats can be silently dropped by Launch Services on running Tauri apps — which is the exact bug this code path was created to fix for markdown. Generalizing to all supported formats is mandatory for Phase 1B's "Open With" promise (WI-1B.11).

**Important:** `src/utils/yamlOpenRouting.ts` is **NOT deleted in Phase 1B**. It stays live until WI-2.6. Until then, the YAML force-source bandaid keeps working as a markdown-adapter-internal concern (the markdown adapter's mode dispatch consults it; non-markdown adapters bypass).

**DoD:**
- macOS Finder "Open With VMark" works for all registered extensions.
- Drag-drop accepts all registered extensions; reject toast appears only for unrecognized types.
- `Cmd+O` shows "All Supported" + "Markdown" filters.
- `Save As` of a `.txt` tab defaults to `.txt`.
- Save-on-close prompt for a dirty `.json` tab uses `.json` filter, not `.md`.
- Recent-files reopen of `.yaml` works.
- Content search Cmd+Shift+F finds text in `.json` / `.yaml` files in the workspace.
- `scripts/check-ext-sync.sh` exits 0 (Rust ↔ TS extension lists match).
- DoD script `bash scripts/check-multi-format-phase.sh 1B` exits 0.

### Phase 2 — Data formats + first schema detectors (estimate: 1.5 weeks)

Stubs from Phase 1A become full implementations.

- **WI-2.1** — JSON / JSONL adapter. Real `loadLanguage` (`@codemirror/lang-json`), `JSON.parse` validator, tree preview from WI-0.5 library. JSONL parses line-by-line with per-line gutter.
- **WI-2.2** — TOML adapter. `legacy-modes/mode/toml` + `smol-toml` validator + tree preview.
- **WI-2.3** — YAML adapter. Real `loadLanguage` (`@codemirror/lang-yaml`), `js-yaml` validator, tree preview.
- **WI-2.4** — GHA workflow detector wire-up (schema POC #1). `src/lib/ghaWorkflow/detection.ts` (`looksLikeWorkflowPath` + `isWorkflowYaml`) wires into the YAML adapter as `schemaDetector`. `<WorkflowEditorPanel>` becomes `schemaRenderers["gha-workflow"]`. Existing `sourceGhaWorkflowPreview` CodeMirror plugin is **deleted**, replaced by registry-driven path. Regression-tested against 10+ existing workflow YAML fixtures (zero behavioral change).
- **WI-2.5** — `Cargo.toml` detector + dependency-tree renderer (schema POC #2 — the differentiator validation). Detector matches filename `Cargo.toml` (path) AND content has top-level `[package]` (content fallback). Renderer reads `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]`, displays crate-name/version/features tree. **No network calls** in v1.
- **WI-2.6** — Delete `src/utils/yamlOpenRouting.ts`. Verify `git grep yamlOpenRouting` returns zero hits. Remove call sites in `useFileOpen.ts:88`, `useDragDropOpen.ts:78`, `useFinderFileOpen.ts:88`, `useRecentFilesMenuEvents.ts:108, 128` (already no-op since Phase 1B routes via registry).

**DoD:**
- `.json`, `.yaml`, `.toml` open with source + tree + parse-error gutter.
- `.github/workflows/ci.yml` opens with workflow visualization (regression: zero behavioral change).
- `Cargo.toml` opens with dependency-tree renderer (new behavior — the differentiator).
- 5+ malformed-fixture tests per format show gutter markers at correct line/column.
- Tab persistence preserves format-specific tab kind and `activeSchemaId`.
- DoD script `bash scripts/check-multi-format-phase.sh 2` exits 0.

**Phase 2 is the rebrand gate.**

### Phase 3 — Visual-render formats (estimate: 1 week)

- **WI-3.1** — Standalone `.mmd` adapter. `codemirror-lang-mermaid` + Langium validator + wrapper around `renderMermaid()`. Wrapper handles theme + font-size synchronization explicitly (since `renderMermaid` is environment-coupled per Background).
- **WI-3.2** — Standalone `.svg` adapter. `@codemirror/lang-xml` + XML well-formedness validator + inline-render wrapper around `renderSvgBlock()`.
- **WI-3.3** — `.html` / `.htm` adapter. `@codemirror/lang-html` + HTML5 parser warnings + `<HtmlSandboxPreview>` (ADR-4). Optional `DOMPurify` sanitization.
- **WI-3.4** — Security review checkpoint. Manual XSS test against HTML preview using OWASP top-20 payload list. Sign-off in `dev-docs/grills/multi-format/security-review-html.md`.

**DoD:** Each format renders + refreshes on edit (debounced 300ms) + shows parse warnings as gutter markers. HTML iframe denies all OWASP top-20 XSS payloads. DoD script exits 0.

### Phase 4 — Code viewing (estimate: 3-5 days)

- **WI-4.1** — Language pack registration: all extensions from ADR-3.
- **WI-4.2** — Read-only banner above source pane. i18n-keyed.
- **WI-4.3** — Per-tab editing toggle (persisted via `TabFormatState.editingEnabled`).
- **WI-4.4** — `open_in_external_editor(path)` Tauri command. macOS / Windows / Linux variants. macOS uses `ai_provider::login_shell_path()` for GUI PATH per AGENTS.md.

### Phase 5 — Additional schema-aware previews (estimate: 1.5-2 weeks)

POC #1 (GHA) and POC #2 (Cargo.toml) shipped in Phase 2.

- **WI-5.1** — `package.json` detector + dependency-tree view.
- **WI-5.2** — `pyproject.toml` detector + dependency-tree view (PEP 621 + Poetry sections).
- **WI-5.3** — DEFERRED: OpenAPI / Swagger browser (Phase 5b).

### Phase 6 — Rebrand (estimate: 3-5 days)

Gated on Phase 2 shipping.

- **WI-6.1** — Tagline propagation: README.md, `website/.vitepress/config/shared.ts`, `website/index.md`, `package.json` description, `src-tauri/tauri.conf.json` description, `src-tauri/Cargo.toml` description, About dialog string in `src/locales/en/*.json`, `vmark-mcp-server/package.json` description.
- **WI-6.2** — Website restructure around multi-format + AI-collaboration narrative.
- **WI-6.3** — `website/guide/formats.md` documenting every supported format.
- **WI-6.4** — Launch artifact: blog post + screenshot reel (5+ formats open simultaneously).
- **WI-6.5** — Translation pass via `/translate-docs` skill across all 9 locales.

## Risks

1. **Phase 1A is the long pole.** *Mitigation:* WI-0.7 risk audit; split surface refactor into atomic PRs; regression-test markdown fixtures at every step.
2. **Phase 1B touches 13+ distinct sites.** *Mitigation:* enumerated WIs; WI-1B.1 through WI-1B.16 each owns one site; CI check `scripts/check-ext-sync.sh` for Rust↔TS sync per ADR-12.
3. **Stub registrations could be mistaken for working features.** *Mitigation:* Phase 1A DoD test verifies `.json` opens with raw CodeMirror (no highlight, no preview) — confirms stubs route correctly without claiming feature-completeness; toast on first non-markdown open (during Phase 1A only) reads "Editor for {format} is in development. Source view available."
4. **Scope creep into code editing.** *Mitigation:* ADR-3 read-only default; document the line in `formats.md`.
5. **WYSIWYG-vs-source UX inconsistency.** *Mitigation:* explicit format-mode tab-title icon.
6. **HTML iframe XSS.** *Mitigation:* ADR-4 + WI-0.4 spike + WI-3.4 security review.
7. **Tab perf at scale.** *Mitigation:* WI-1A.10 includes 50-mixed-tab benchmark; lazy-mount surfaces if p99 > 200ms.
8. **Validator UX drift.** *Mitigation:* ADR-8 + single gutter component (WI-1A.8).
9. **Markdown frontmatter conflict.** *Mitigation:* ADR-7.
10. **Schema detector demand unvalidated.** *Mitigation:* WI-2.5 lands in Phase 2; user feedback before Phase 5.
11. **Hallucinated dependencies.** *Mitigation:* `scripts/check-new-deps.sh` per AI gov rule 4; WI-0.6 maintenance audit.
12. **Existing markdown users alienated.** *Mitigation:* Phase 1A DoD requires byte-identical markdown behavior.
13. **Mermaid renderer environment coupling.** *Mitigation:* WI-3.1 wrapper handles theme + font-size sync.
14. **YAML regression window.** *Mitigation:* WI-2.6 deletion postponed to end-of-Phase-2.
15. **Rust↔TS extension list drift.** *Mitigation:* ADR-12 + `scripts/check-ext-sync.sh` CI guard.
16. **Content-search scope expansion surprises users.** *Mitigation:* WI-1B.13 default excludes code-viewer formats; settings toggle for power users.
17. **Symlink security regression in `validate_openable_path`.** *Mitigation:* WI-1B.5 manual security test; existing canonicalization behavior preserved.

## Open questions

1. ~~Tree preview library~~ **CLOSED (Phase 0 WI-0.5):** `react-json-view-lite` >=2.5.0. Mechanism: only candidate with documented keyboard nav + ARIA labelling.
2. ~~TOML parser library~~ **CLOSED (Phase 0 WI-0.6):** `smol-toml` >=1.6.1. `@iarna/toml` rejected as effectively unmaintained.
3. ~~Mermaid CodeMirror language pack~~ **CLOSED (Phase 0 WI-0.6):** `codemirror-lang-mermaid` 0.5.0 pinned exactly. SUFFICIENT-FALLBACK verdict — stale (last commit 2023-09-14) but no CVEs, no functional risk for stable mermaid grammars. v1.x backlog item: replace if upstream remains dormant past 2026-09.
4. ~~`.rb` and `.lua` packs~~ **CLOSED (Phase 0 WI-0.6):** ship in v1 via `@codemirror/legacy-modes/mode/{ruby,lua}` — same path the plan uses for TOML, `.sh`, `.bash`.
5. **`open_in_external_editor` macOS PATH** — verify in WI-4.4.
6. **`pyproject.toml` detector scope** — PEP 621 + Poetry. Decide in WI-5.2.
7. **OpenAPI as Phase 5b** — defer until Phase 5 completes.
8. **DOMPurify sanitization layer** — defense-in-depth or YAGNI? Default include; remove if WI-3.4 shows iframe sandbox alone is sufficient.
9. **Rust ↔ TS extension list mechanism** — ADR-12 picks manual mirror + CI check; revisit in v1.x if drift incidents recur.

## Verification gates

| Gate | Tool | When |
|---|---|---|
| WI linkage | `bash scripts/check-wi-linkage.sh dev-docs/plans/20260506-multi-format-rebrand.md` | After every phase commit |
| Phase DoD | `bash scripts/check-multi-format-phase.sh <N>` (N ∈ {0, 1A, 1B, 2, 3, 4, 5, 6}) | Before phase Status header advances |
| Dep hallucination | `bash scripts/check-new-deps.sh` | Every PR adding deps |
| Rust↔TS ext sync | `bash scripts/check-ext-sync.sh` (NEW per ADR-12) | Every PR touching the registry or `lib.rs` extension constants |
| TDD hook | New `.claude/hooks/multi-format-tdd-guard.mjs` (parallel to `gha-tdd-guard.mjs`) — file-path-scoped (matches `gha-tdd-guard` model). Production paths covered: `src/lib/formats/**`, `src/components/Editor/SplitPaneEditor/**`, `src/components/Editor/Editor.tsx`, `src/components/Editor/SourceEditor.tsx`, `src/hooks/useFileOpen.ts`, `src/hooks/useFileSave.ts`, `src/hooks/useDragDropOpen.ts`, `src/hooks/useFinderFileOpen.ts`, `src/hooks/useRecentFilesMenuEvents.ts`, `src/hooks/closeSave.ts`, `src/hooks/useExternalFileChanges.ts`, `src/stores/tabStore.ts`, `src/stores/contentSearchStore.ts`, `src/utils/dropPaths.ts`, `src/utils/newFile.ts`, `src/utils/macQuarantineNotice.ts`, `src/utils/yamlOpenRouting.ts` (until WI-2.6), `src-tauri/src/lib.rs` (whole-file scope — granular function scoping isn't supported by the current guard model), `src-tauri/src/window_manager.rs` (whole-file), `src-tauri/src/quarantine.rs` (whole-file). Allow-list within scope: `*.test.ts(x)`, `*.test.rs`, `types.ts`, `*.d.ts`, `*.css`. | Pre-Write/Edit on every WI |
| i18n keys | Each WI introducing user-visible strings adds `en` keys in same commit (Phase 6 batches translation) | Per-WI review |
| Cross-model review | `/codex-toolkit:review-plan` | Required again after this revision; mandatory before Phase 1A commits |
| Coverage | `pnpm check:all` | Before every merge |
| HTML XSS | OWASP XSS top-20 payload list manual test | WI-3.4 sign-off |

## Rebrand-readiness checklist

Before Phase 6 begins:

- [ ] Phase 2 merged (markdown + txt + json + yaml + toml + GHA-via-registry + Cargo.toml dep tree all ship)
- [ ] No regressions in markdown editing
- [ ] All Phase 2 formats have ≥80% line coverage
- [ ] `dev-docs/grills/multi-format/perf-bench.md` shows 50-mixed-tab switch p99 < 200ms
- [ ] `yamlOpenRouting.ts` deleted (WI-2.6)
- [ ] HTML security review (Phase 3) signed off
- [ ] Cross-model review of revision 4 (or current revision): APPROVE or APPROVE-WITH-NOTES

## Appendix A — Why not just use VS Code?

VMark's defaults differ from VS Code's by direction-of-gradient: VS Code is a *code editor* that opens prose; VMark is a *prose-and-artifact workspace* that opens code.

| Default | VS Code | VMark |
|---|---|---|
| Markdown editing | Source mode | WYSIWYG |
| Mermaid in markdown | Plugin (manual) | First-class render |
| GitHub Actions YAML | Source + extension hint | Workflow visualization |
| `Cargo.toml` | Source | Dep tree (Phase 2) |
| `package.json` | Source | Dep tree (Phase 5) |
| Code files | Edit + LSP | View only (ADR-3) |
| AI integration | Chat sidebar | MCP + Genies + suggestions inline |
| Tabs | Code-centric | Document-centric |

## Appendix B — Why "humans and AI" not "AI"

The "and" matters. AI-first framing puts humans in the user-of-tool position. Human-and-AI framing names the artifact as the shared substrate, with both parties reading and writing it directly. Plain text is the un-mediated meeting point; VMark optimizes the experience of working in that meeting point.

## Appendix C — Resolution of cross-model review findings

### Review iteration 4 (verdict: NEEDS-REVISION → addressed in revision 5)

Codex thread `019dfb2e-e1ed-7042-b5ed-5c8bafc9329b` against revision 4.

| Codex finding | Severity | Resolution in revision 5 |
|---|---|---|
| WI-1A.11 stub registration conflicts with `registerFormat()` invariant 4 (loadLanguage required for non-wysiwyg) | BLOCKER | Invariant 4 expanded to allow stubs and plain `.txt` to omit `loadLanguage`; raw CodeMirror fallback documented |
| Phase 1A WI ordering doesn't follow WI-0.7 refactor-audit's PR sequence (audit's PR 2 tab-kind plumbing is in Phase 1B; PR 4 menu routing not scheduled "immediately after PR 1") | HIGH | Added new WI-1A.12 (tab kind-change contract, moved from WI-1B.15); added explicit "Build order" note in Phase 1A naming WI-1A.7 as the long pole |
| Tree library citation inconsistency: `@uiw/react-json-view or alternative` (line 318) vs WI-0.5 closed with `react-json-view-lite` (line 523) | LOW | Tree preview library citation updated to `react-json-view-lite` v2.5.0 with mechanism noted |
| Rebrand-readiness checklist still references "revision 3" cross-model review (line 557) | LOW | Wording generalized to "revision 4 (or current revision)" so future revisions don't need this edit |

### Review iteration 1 (verdict: MAJOR GAPS)

Resolved in revision 1. See git history for that diff.

### Phase 0 spike findings (revision 4)

Phase 0 spikes (`dev-docs/grills/multi-format/findings.md`) executed 2026-05-06 with verdict PASS for Phase 1A and Phase 2; Phase 3 BLOCKED on user-run Tauri webview XSS test (WI-0.4 Part B).

| Finding | Source | Plan change |
|---|---|---|
| Tree library: `react-json-view-lite` >=2.5.0 | WI-0.5 | New-deps table, Open Q #1 closed |
| TOML parser: `smol-toml` >=1.6.1 | WI-0.6 | New-deps table, Open Q #2 closed |
| Mermaid pack: `codemirror-lang-mermaid` 0.5.0 pinned exactly | WI-0.6 | New-deps table (staleness mitigation noted), Open Q #3 closed |
| `.rb` and `.lua` ship via `@codemirror/legacy-modes` | WI-0.6 | ADR-3 reinstates them; Final format surface adds rows; Open Q #4 closed |
| `dompurify` >=3.4.2 to avoid CVE-2025-15599 + CVE-2026-0540 | WI-0.6 | New-deps table version pin |
| `useUnifiedMenuCommands` is the long pole, not `Editor.tsx` | WI-0.7 | Risk #1 already calls this out; Phase 1A WI ordering preserved |
| HTML sandbox harness needs Tauri-webview verification | WI-0.4 | Phase 3 gate on user sign-off; harness in `dev-docs/grills/multi-format/spike-04-html-sandbox/` |

### Review iteration 3 (verdict: NEEDS REVISION → addressed in this revision)

| Codex finding | Severity | Resolution |
|---|---|---|
| Ambiguity-1 PARTIAL: side-panel keep-alive lifecycle still implicit | MEDIUM | `FormatAdapters.sidePanelKeepAlive` field added with three-value enum |
| Risk-4 / Gap-4 PARTIAL: TDD hook missed quarantine path | HIGH | Hook scope extended to `src-tauri/src/quarantine.rs` and `src/utils/macQuarantineNotice.ts` |
| Gap-2 PARTIAL: macOS quarantine path is markdown-only | HIGH | New WI-1B.16 generalizes `strip_workspace_quarantine` to all `SUPPORTED_EXTENSIONS`; locale strings reworded |
| Fresh-3: `closeSavePolicy: "no-save"` ambiguous for editable viewers | MEDIUM | `"no-save"` removed from the union; explicit invariant added — formats with `readOnlyDefault: true` MUST use `closeSavePolicy: "markdown-default"` because `editingEnabled = true` makes them dirty-capable |
| Fresh-1 (stub registration): no new issue | INFO | Confirmed by Codex — stubs do not interfere with markdown frontmatter detection |
| Fresh-2 (ADR-12 mirror burden): acceptable but real | LOW | Tracked as Risk #15; revisit in v1.x if drift incidents recur |

### Review iteration 2 (verdict: NEEDS REVISION)

| Codex finding | Severity | Resolution in revision 2 |
|---|---|---|
| Completeness-1 PARTIAL: missing entry-point sites (`useFinderFileOpen`, `useRecentFilesMenuEvents`, `window_manager.rs`, `closeSave`, `newFile`, `dropPaths`, `contentSearchStore`) | HIGH | Phase 1B expanded from 10 to 15 WIs covering every site; Background table now lists definition + call sites for each |
| Completeness-2 PARTIAL: `closeSave.ts` markdown-only flows omitted | HIGH | WI-1B.8 explicit; `closeSavePolicy` field added to FormatAdapters |
| Completeness-4 PARTIAL: tree preview a11y unspecified | HIGH | Tree preview interaction spec extends to ARIA roles + screen-reader announcements |
| Feasibility-3 PARTIAL: `.rb` / `.lua` undecided | MEDIUM | ADR-3 explicit: deferred unless WI-0.6 audit clears them |
| Ambiguity-1 PARTIAL: `FormatConfig` underspecified | BLOCKER | `FormatAdapters` extended with `searchAdapter`, `contentSearchIndexed`, `readOnlyDefault`, `reloadPolicy`, `sidePanelComponent`, `menuPolicy`, `closeSavePolicy` |
| Risk-4 PARTIAL: TDD hook scope still misses files | HIGH | TDD hook scope expanded; lib.rs / window_manager.rs are whole-file scope (admitted limitation per current guard model) |
| New-gap-1: `FormatConfig` missing fields ADR-2 claims | BLOCKER | Same fix as Ambiguity-1 above |
| New-gap-2: Phase 1B doesn't enumerate all sites | BLOCKER | WI list expanded |
| New-gap-3: Phase 1B DoD requires non-markdown formats to work in Finder/Open With before they're registered | BLOCKER | New WI-1A.11 stub-registers all formats in Phase 1A; Phase 1B DoD now achievable |
| New-gap-4: TDD hook scope still incorrect | HIGH | Whole-file scope for `lib.rs` and `window_manager.rs` admitted; smaller-grained scoping defers to v1.x |
| New-gap-5: Background table imprecise | LOW | Table rewritten with definition / call-site columns; lib.rs:118 cited as definition; lib.rs:965 explicitly called out as test assertion; YAML routing call sites enumerated |
