# ADR-015: Extension Model — Flat Peers, Host-Owned Extension Points, Schema-Owned Serialization

> Status: **Proposed** | Date: 2026-07-22
> Supersedes: ADR-011 (plugin manifest contract)
> Depends on: ADR-001 (markdown as source of truth), ADR-013 (service tier)
> Evidence: `dev-docs/deep-researches/20260721-extension-architecture-investigation.md`,
> `dev-docs/deep-researches/20260722-extension-architecture-prior-art.md`

## Context

The goal is a minimal core with everything else an extension, and eventually a
third-party ecosystem. Three prior attempts at seams exist, and all three drifted.
Measured 2026-07-22:

| Seam | Claimed | Measured |
|---|---|---|
| Plugin manifest registry (ADR-011) | "manifest exports complete" | 77 manifests; **2** carry a `tiptap()` factory, **1** declares `slots`/`commands`/`dependsOn`; `pluginsFor()` has **zero** production callers |
| `plugin-isolation` dep-cruiser rule | enforced | severity `warn` + 22 exemptions ⇒ **201** violations, of which 7 visible, CI never red |
| Editor host interface (ADR-010) | accepted, then scoped down | no `EditorHost` type exists; even the weakened fallback gate (`source*Popup` dirs empty) fails — 6 remain |

The common cause is not neglect. `registry.ts` states its own design:

> *"Foundation-only: existing `editorPlugins.tiptap.ts` continues to hand-compose
> plugins. Manifests are additive metadata… Migrating the hand-composition path
> is a follow-up."*

**A constraint that cannot fail is not a constraint.** Metadata that describes a
hand-wired composition has no observer, so drift is undetectable. Prior art
confirms this is structural, not incidental: no examined system (CodeMirror,
VSCode, Obsidian) uses manifest-plus-hand-wiring, and it is the one combination
guaranteed to decay.

Two further measured facts shape the decisions:

- **Serialization is centralized.** 100% of markdown-conversion knowledge lives in
  `src/utils/markdownPipeline/` — a 24-arm PM→mdast switch, a 31-arm mdast→PM
  switch, and a 9-arm mark switch. Not one plugin owns any of it. A node
  therefore cannot exist without the pipeline being edited.
- **The core is already largely format-agnostic.** All 94 store files are free of
  markdown imports; `useDocumentStore` holds an opaque string. `SplitPaneEditor` +
  `SourcePane` is a working generic CodeMirror host already serving 17 of 18
  formats. Markdown/Tiptap is the exception, not the base.

## Decisions

### D1 — An extension is a value, not a manifest

Adopt CodeMirror's model. The registry **is** the composition:

```ts
type VMarkExtension = { extension: VMarkExtension } | readonly VMarkExtension[]
```

Nested arbitrarily, flattened and deduplicated by value identity at resolve time.
There is no second representation, so nothing can drift. Corollary: **no side
channel.** No `editor.addFeature()`, no direct schema mutation, no `registerLate()`.
If a feature did not return an extension value, it does not exist.

*Rejected:* keeping the manifest as metadata (status quo — proven to decay);
VSCode's model (viable only if the manifest is the sole producer of a
user-visible surface, which would require rendering menus/palette from it —
a larger change for a weaker guarantee).

### D2 — Markdown conversion lives on the node spec

Following Milkdown, each node and mark carries its own converters in both
directions:

```ts
interface MarkdownConversion {
  toMdast:   { match: (node: PMNode) => boolean; runner: (state, node) => void }
  fromMdast: { match: (node: MdastNode) => boolean; runner: (state, node, type) => void }
}
```

Schema membership and serializer ownership become the same act — the switch
cannot grow back, because there is nowhere to add an arm. `match` is a
**predicate**, not a name key, so an extension can claim by attribute
(`node.attrs.language === "mermaid"`), which name-keying cannot express.

Dispatch indexes by node name first and falls back to predicate scan only for
specs declaring a non-trivial `match` — Milkdown's unconditional
`Object.values(schema).find(...)` is O(nodes × schema types) and does not survive
a third-party ecosystem.

Unknown nodes **throw** (`strict: true`), so a missing converter fails loudly in
CI rather than silently emitting empty markdown. An HTML-passthrough fallback
exists as an explicit opt-in for third-party nodes only.

### D3 — No extension hierarchy

"Markdown is an extension; mermaid and sli.dev are sub-extensions of markdown" is
**refuted by prior art** — every system examined flattens nesting, and the three
that let markdown host foreign content (`@codemirror/lang-markdown` `codeLanguages`,
Obsidian `registerMarkdownCodeBlockProcessor`, VSCode `injectTo`) all use a
host-owned keyed registry with contributors as **peers**.

The intent decomposes into two supported mechanisms:

1. **Grouping** for authoring and distribution — a function returning a flat list
   of same-typed values (`markdownExtensions()` returning its standard pieces),
   exactly as `gfmFromMarkdown()` does.
2. **Host-owned extension points** — markdown declares a keyed extension point
   (fence-language dispatch); mermaid and sli.dev are top-level peers registering
   into it.

Names live in one flat namespace. Rationale: a fence renderer is useful in
markdown, table cells, and the source pane — as markdown's child it could serve
only markdown; and qualified names would have to thread through schema types,
commands, settings keys, and i18n keys for no benefit.

### D4 — Ordering is declarative

Five named precedence buckets (`highest`/`high`/`default`/`low`/`lowest`) for
coarse layering, plus named `before`/`after` referencing a peer extension for
genuinely pairwise constraints. **No integer priority scale** — it is unbounded,
unauditable, and invites escalation.

The existing 78-entry hand-ordered array is dismantled incrementally: Tiptap
already treats array position as a stable-sort *tiebreaker*, so each entry's
implicit position can be replaced by an explicit declaration plus a test, one at
a time. When order affects no test, the array is sorted alphabetically.

### D5 — Third-party code never runs with document-window identity

Carried forward from the 2026-07-21 investigation and unchanged. The Tauri ACL is
per-**window**, not per-**caller**, and 157 custom commands are not ACL-gated;
in-webview plugin JS would inherit `pty_spawn` (arbitrary exec), `run_ai_prompt`
(`cli_path` unvalidated), `atomic_write_file`, and a flat keychain.

Trust tiers: **A** declarative (signed JSON, no code) → **C** sidecar process
(generalized MCP bridge + the existing production-grade capability broker) → **B**
sandboxed worker/WASM → **D** schema nodes and Rust commands, first-party or
signed-partner only. D2 is a **precondition** for D-tier, not a substitute for it.

### D6 — Every architectural constraint must be able to fail CI

No constraint ships as documentation, `warn` severity, or metadata. Each gets a
gate that goes red:

| Constraint | Gate |
|---|---|
| Registry matches composition | Contract test `set(registry) === set(composed)` |
| Core names no feature | dep-cruiser rule, severity `error` |
| Plugins stay isolated | `plugin-isolation` promoted to `error` with a ratcheting exemption budget |
| Every schema node round-trips | `strict: true` + corpus characterization on the **production** schema |

Exemption lists are permitted only with a documented reason and a burn-down
budget that ratchets down, never up — the pattern established by
`scripts/file-size-baseline.json`.

## Consequences

**Good**
- ADR-001 survives untouched: the store keeps holding an opaque string. Markdown
  becomes an interpretation of that string rather than a privileged format.
- The plain-text core mostly exists already (`SplitPaneEditor`/`SourcePane`,
  17/18 formats). The work is removing markdown's privileges, not building a core.
- D2 is the prerequisite the 2026-07-21 investigation identified for third-party
  editor nodes, so it advances both the internal and ecosystem goals.
- Mermaid, graphviz, markmap, and svg need **zero** pipeline work — they are
  `codeBlock` nodes with a language string, so they are pure D3 extension-point
  contributions.

**Bad / accepted costs**
- ADR-011 is superseded; 77 manifests are deleted or converted to values.
- ~700 of ~2,600 non-test pipeline lines are **document-scoped and will not
  decompose**: mark-run factoring (`groupInlineItems`), `mergeInlineHtmlTags`, the
  verified cosmetic unescape pass, blank-line capture, PUA escape markers, list
  normalization, and heading-slug uniqueness. "Everything is per-node" is not
  achievable; a document-scoped pipeline core remains by design.
- Four node families need design before code: `alertBlock` (parse and serialize
  use different mdast shapes, so `blockquote` and `alertBlock` are mutually
  entangled), media (`block_video`/`block_audio`/`block_image` compete to claim
  the same two mdast types in both directions, with priority implicit in `if`
  order), `video_embed` (same, plus an outbound security allowlist), and the
  residual `html` arm.
- ADR-010's `EditorHost` stays dead, and this ADR endorses that: prior art
  confirms a cross-engine host interface degrades to a lowest-common-denominator
  string-and-cursor API. Mode dispatch stays at the format-registry level.

**Risk requiring action before any code**
- The corpus characterization harness runs against `testSchema.ts`, **not** the
  production schema, and that schema omits `toc`, `block_video`, `block_audio`,
  and `video_embed`. Converters return `null` for absent node types, so those
  constructs are silently dropped and the golden files **approve the deletion**.
  A `[TOC]` line would vanish and the test would stay green. The safety net must
  be fixed before it is relied upon — see the plan's Phase 0.

## Verification gates

- `set(registryEntries) === set(composedExtensions)` — contract test, red on drift
- No production file outside the pipeline imports a converter switch
- `grep -rE "case \"" proseMirrorToMdast.ts` returns 0 arms
- Corpus characterization runs on the production schema, with fixtures covering
  every custom syntax enumerated in the plan
- `plugin-isolation` severity is `error`; exemption count only decreases
- `pnpm check:all` green throughout
