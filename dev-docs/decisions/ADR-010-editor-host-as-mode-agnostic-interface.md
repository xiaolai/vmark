# ADR-010: Editor host as mode-agnostic interface

> Status: **Proposed** | Date: 2026-05-24

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
