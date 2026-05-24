# ADR-010: Editor host as mode-agnostic interface

> Status: **Revised — Scoped Down** | Date: 2026-05-24 | Spike: 2026-05-24

## Context

Source and WYSIWYG modes are implemented as parallel plugin trees. Six
features ship twice: `plugins/linkPopup/` + `plugins/sourceLinkPopup/`,
`plugins/footnotePopup/` + `plugins/sourceFootnotePopup/`,
`plugins/mathPopup/` + `plugins/sourceMathPopup/`,
`plugins/wikiLinkPopup/` + `plugins/sourceWikiLinkPopup/`,
`plugins/imageView/` + `plugins/sourceImagePopup/`,
`plugins/linkCreatePopup/` + `plugins/sourceLinkCreatePopup/`.

The pattern partially exists already.
`plugins/toolbarActions/{wysiwyg,source}Adapter*.ts` adapts actions across
modes. `plugins/sourcePopup/` is a partial base for source-mode popups.
The remaining duplication is in plugin controllers (PM Plugin vs.
CM ViewPlugin) and React views. Today, mode is a code branch, not a
projection on shared state.

## Considered Options

1. **Status quo** — accept 2× cost per feature; document the pattern.
2. **Unify popups only** — existing T11; lifts views and stores but keeps
   the rest of the plugin tree per-engine.
3. **Editor host as a mode-agnostic interface** — Tiptap and CodeMirror
   become adapters behind a common API; plugins consume the API; mode
   becomes a projection.

## Decision

Chosen: **Option 3 — `EditorHost` is the contract**. Tiptap and CodeMirror
implement it. Plugins target `EditorHost`, not the engine. Mode-specific
code is constrained to a single controller file per plugin; views and
state are mode-agnostic.

```ts
interface EditorHost {
  document: Document;                    // from ADR-009
  selection: SelectionRange;             // mode-agnostic
  applyEdit(op: EditOp): void;
  observe<T>(selector: (h: EditorHost) => T): Subscription;
  mountWidget(at: WidgetAnchor): WidgetSlot;
}

interface Plugin {
  manifest: PluginManifest;              // from ADR-011
  mount(host: EditorHost): Cleanup;
}
```

The existing adapter family
(`plugins/toolbarActions/{wysiwyg,source}Adapter*.ts`) is the template,
lifted from the action layer to the host layer.

## Verification gate

- `find src/plugins -type d -name 'source*Popup'` returns empty.
- For each previously-duplicated feature, the `view.tsx` and `state.ts`
  files import neither `@tiptap/*` nor `@codemirror/*`.
- `grep -rln "from.*@tiptap\|from.*@codemirror" src/plugins/` matches only
  controller files (one per mode per feature, max).
- E2E parity: every dual-mode feature passes the same behavior suite in
  both modes (`describe.each(['source', 'wysiwyg'])`).

## Consequences

- **Good**: adding a feature is one plugin + two thin controllers, not two
  full feature folders. Mode parity stops being a tax. Reskin styles one
  popup per feature, not two. i18n keys deduplicate across 10 locales.
- **Bad**: requires Tiptap and CodeMirror to expose comparable APIs for
  selection and edit application; some cases (mark vs block, composition)
  need adapter-specific shims. Highest-risk decision in this ADR set —
  must be validated by a spike on `linkPopup` before committing the full
  set of six.

## Negative space

`EditorHost` does NOT eliminate Tiptap or CodeMirror. Does NOT promise
zero mode-specific code; caps it at controller files. Does NOT cover
read-only embeds (preview-only) — those stay separate.

## Dependencies

- Requires ADR-009 (Document model) for the input.
- Drives the work in existing plan task T11; absorbs T10's popup
  co-location side-effect.
- Spike outcome on `linkPopup` is the gate before adopting beyond
  proposal status.

## Spike outcome (2026-05-24) — VERDICT: scope down

Read both implementations end-to-end:

| File | Engine | Lines | Detection model | Edit model |
|---|---|---|---|---|
| `plugins/linkPopup/tiptap.ts` | Tiptap | 239 | Mark traversal on node tree | PM `Transaction` against mark range |
| `plugins/linkPopup/LinkPopupView.ts` | Tiptap | 260 | (view only) | (view only) |
| `plugins/sourceLinkPopup/sourceLinkPopupPlugin.ts` | CM | 176 | Regex on flat text | CM `Transaction` replacing chars |
| `plugins/sourceLinkPopup/SourceLinkPopupView.ts` | CM | 173 | (view only) | (view only) |

**The honest verdict on EditorHost-as-whole-editor:**

The data models genuinely diverge. ProseMirror has a typed node tree
with marks; CodeMirror has flat text with decorations. ProseMirror has
node selections; CodeMirror does not. ProseMirror transactions operate
on document positions; CodeMirror transactions operate on character
offsets. An interface that abstracts both at the "host" level either
becomes a lowest-common-denominator string-and-cursor API (losing
both engines' power), or leaks the underlying model through enough
union types that callers might as well branch on the engine.

**A `linkPopup` controller that only uses an `EditorHost` API would
need every detail of both data models exposed — at which point it
isn't an abstraction, just a wider surface.** The first-draft ADR-010
oversold this.

**What IS feasible and already partly proven:**

A *per-operation* adapter pattern:

- `plugins/toolbarActions/{wysiwyg,source}Adapter*.ts` already abstracts
  toolbar actions across engines.
- `plugins/sourcePopup/` (`SourcePopupView`, `createSourcePopupPlugin`)
  already extracts shared CodeMirror popup infrastructure. No Tiptap
  equivalent exists yet.
- Both engines can populate the same Zustand store
  (`useLinkPopupStore`) — already the case.

**Revised decision (scope down ADR-010 → 011 territory):**

Drop the goal of a unified `EditorHost`. Instead, for each dual-mode
feature, ship:

1. **One React view** (the popup) in `plugins/<feature>/<Feature>PopupView.tsx`.
2. **One shared state** (Zustand store) — already pattern.
3. **Two thin controllers**: `plugins/<feature>/tiptap.ts` and
   `plugins/<feature>/codemirror.ts`. Each detects feature presence
   and dispatches the appropriate engine transaction. Logic that does
   not touch engine internals (string parsing, URL handling, navigation)
   lives in a `plugins/<feature>/operations.ts` file consumed by both.

The `source*Popup/` directories then collapse into the parent feature
folder, with `codemirror.ts` replacing the standalone module.

**What this means for downstream ADRs:**

- **ADR-011 (Plugin manifest)**: needs `modes: ('source' | 'wysiwyg')[]`
  and a controller declaration per mode — already the manifest shape.
  Survives unchanged.
- **ADR-009 (Document model)**: unaffected; document is the input to
  both controllers.
- **Existing plan T11 (source/WYSIWYG popup unification)**: this is the
  actual mechanism. T11 was approximately right; ADR-010 in its first
  draft overpromised by trying to abstract the entire editor surface.

**Verification gates — revised:**

- Each previously-duplicated feature has **one** view, **one** state,
  **one** operations file, **two** controllers (max).
- `find src/plugins -type d -name 'source*Popup'` returns empty after
  T11/this-ADR's work lands per-feature.
- View files import neither `@tiptap/*` nor `@codemirror/*`.
- Controller files are <200 LOC each (forces logic to live in
  `operations.ts`).

**What gets dropped from the original ADR:**

- The `EditorHost` interface itself. No common selection/edit API
  across engines.
- The promise that plugins "consume `EditorHost`." Plugins still target
  the engine through a thin controller.
- The verification line "`grep -rln 'from.*@tiptap\|from.*@codemirror'
  src/plugins/` matches only controller files" — still useful, kept.

This is a **smaller** but **more truthful** ADR. The original was
architecturally ambitious in a way the engines do not support.
