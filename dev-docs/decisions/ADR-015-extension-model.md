# ADR-015: Extension Model — Flat Peers, Host-Owned Extension Points, Extension-Owned Conversion

> Status: **Proposed** | Date: 2026-07-22
> Supersedes: ADR-011 (plugin manifest contract)
> Depends on: ADR-001 (markdown as source of truth), ADR-003 (Tiptap over
> Milkdown), ADR-013 (service tier)
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

- **Editor conversion is centralized.** All production PM↔mdast dispatch and
  converter implementations are assembled under `src/utils/markdownPipeline/` —
  a 24-arm PM→mdast switch, a 31-arm mdast→PM switch, and a 9-arm mark switch.
  **No Tiptap extension owns its adapter**, so a node cannot exist without the
  pipeline being edited.
  *Correction (Codex review):* an earlier draft said "100% of markdown-conversion
  knowledge". That is false. `vmark-content-server/src/render/remarkAlerts.ts:72`
  owns an independent alert transform and assembles its own remark stack
  (`renderMarkdown.ts:153`), and the pipeline *imports* provider knowledge from
  `@/utils/videoProviderRegistry` (`pmBlockConverters.ts:48`). The narrower claim
  above is the true one and is sufficient.
- **The core is already largely format-agnostic.** All 94 store files are free of
  markdown imports; `useDocumentStore` holds an opaque string. `SplitPaneEditor` +
  `SourcePane` is a working generic CodeMirror host already serving 17 of 18
  formats. Markdown/Tiptap is the exception, not the base.

## Decisions

### D1 — An extension is a value, not a manifest

Adopt CodeMirror's principle — the registry **is** the composition, with no
second representation to drift — but **not** its value-identity dedup. An
extension is an explicit descriptor with a stable ID:

```ts
type ExtensionId = string            // "vmark.markdown", "acme.diagram"

interface VMarkExtension {
  id: ExtensionId
  version?: string
  requires?: readonly ExtensionId[]
  ordering?: { bucket?: Prec; before?: readonly ExtensionId[]; after?: readonly ExtensionId[] }
  contributions: readonly Contribution[]
}

type ExtensionGroup = VMarkExtension | readonly ExtensionGroup[]   // grouping only
```

**Why not value identity (Codex review, BLOCKER).** CodeMirror can dedup on
object identity because its extensions are module-level singletons. VMark's
composition is not: `tiptapExtensions.ts:114` and `:142` build values inline via
`StarterKit.configure(...)` and `Link.extend(...).configure(...)`, so a factory
call yields a fresh object each time. Every downstream requirement — `before`/
`after` by name, duplicate detection, third-party namespace ownership, lifecycle
teardown, the registry↔composition contract test, and diagnostics naming the
winning converter — needs a stable name, not an object reference. Tiptap itself
resolves conflicts by extension *name*.

Resolution: flatten groups → reject duplicate IDs unless the resolved descriptor
is identical → validate `requires` and ordering references → topologically sort
with deterministic bucket and registration-order tie-breaks → report full cycle
paths → separately detect duplicate Tiptap extension names after factories run.

Corollary: **no side channel.** No `editor.addFeature()`, no direct schema
mutation, no `registerLate()`. If a feature did not produce a descriptor, it does
not exist.

*Rejected:* keeping the manifest as metadata (status quo — proven to decay);
VSCode's model (viable only if the manifest is the sole producer of a
user-visible surface, which would require rendering menus/palette from it —
a larger change for a weaker guarantee).

### D2 — Conversion ownership splits along the existing Node boundary

Each extension owns its own conversion, but **not as one blob on the node spec**.
VMark has five conversion boundaries, and they do not all belong to the editor.
An extension contributes to two independent registries:

```ts
interface VMarkMarkdownContribution {
  // Registry 1 — markdown layer. Engine-independent, Node-safe.
  micromark?:    SyntaxExtension          // syntax → tokens
  fromMarkdown?: FromMarkdownExtension    // tokens → mdast
  toMarkdown?:   ToMarkdownOptions        // mdast → text (handlers + unsafe + join)

  // Registry 2 — editor adapter layer. ProseMirror-coupled by nature.
  toPm?:   { match: (n: MdastNode) => boolean; runner: (state, node, type) => void }
  fromPm?: { match: (n: PMNode)    => boolean; runner: (state, node) => void }
}
```

**Why the split is load-bearing, not cosmetic.** ADR-003 recorded a
framework-independent remark pipeline as a benefit of leaving Milkdown, and
ADR-001 depends on it ("swapping Tiptap for another WYSIWYG editor only requires
a new Markdown ↔ editor adapter").

*Correction (ADR audit 2026-07-22):* that benefit was **never fully realized**.
11 of 19 non-test pipeline files import `@tiptap/pm/model`, and ProseMirror is in
the public signature — `parseMarkdown(schema: Schema, …)` /
`serializeMarkdown(schema, doc: PMNode, …)` (`adapter.ts:42,84`). The only
genuinely engine-independent seam today is `nodeSafe.ts` + `plugins/` (verified
zero `@tiptap` imports).

So D2 **creates** the boundary rather than preserving one. That strengthens the
case rather than weakening it: putting markdown serialization on Tiptap node
specs would cement a coupling that is currently accidental and reversible. And
`nodeSafe.ts:16`'s invariant needs a lint rule, not just a comment — see the
import-graph gate below.

It would also break a live invariant. `src/utils/markdownPipeline/nodeSafe.ts`
re-exports the remark plugins to `vmark-content-server` under a documented
contract — no `@/` aliases, no DOM globals, **no ProseMirror imports** — guarded
by a Node-only smoke test. Registry 1 must stay where the remark plugins live
today.

**The split alone is not sufficient (Codex review, MAJOR).** If a single
descriptor module imports both its markdown contribution and its ProseMirror
adapter, a Node-safe consumer importing that descriptor transitively loads editor
code — registry 1's *types* stay clean while its *import graph* does not.
Each feature therefore ships three files:

```text
feature/markdown.ts      Node-safe contribution only  (registry 1)
feature/prosemirror.ts   PM adapter only              (registry 2)
feature/index.ts         host-only bundle referencing both
```

Registry 1 accepts plain contributions and never imports a host bundle. This is
enforced by a dep-cruiser **import-graph gate**, not only the existing Node smoke
test. Both registries resolve from one validated contribution graph — parser,
serializer, PM adapters, lint parser, and the content-server projection are all
*derived* from it, never maintained as independently mutable globals (the parser
stack is already conditional at `processorFactory.ts:47` while serialization is
static at `serializer.ts:53`, and the content server assembles a third — exactly
the drift this prevents).

Registry 2 is ProseMirror-shaped, and that is fine: it *is* the "Markdown ↔
editor adapter" ADR-001 already designates as the swappable piece. An engine swap
replaces registry 2 and leaves registry 1 untouched — strictly better than
today, where both are fused into one pipeline.

This mirrors Milkdown's own structure, which keeps `$remark` and `$nodeSchema` as
separate composables for exactly this reason. The pattern being borrowed is
**per-extension conversion ownership**, not Milkdown the framework, and not its
packaging of both layers behind one schema call. Tiptap carries registry 2
natively (v3 extension fields, or `addStorage()` as `tiptap-markdown` does), so
no Milkdown runtime is reintroduced — ADR-003 stands.

`match` is a **predicate**, not a name key, so an extension can claim by
attribute (`node.attrs.language === "mermaid"`), which name-keying cannot express.

**The ownership guarantee survives the split.** It moves from the node spec to
the extension value (D1): an extension contributing a ProseMirror node must also
contribute its registry-2 converters, enforced at the type level, with
`strict: true` and the WI-1.1 contract test as runtime backstops. Neither switch
can grow back, because there is no switch to add an arm to.

Dispatch indexes by node name first and falls back to predicate scan only for
specs declaring a non-trivial `match` — Milkdown's unconditional
`Object.values(schema).find(...)` is O(nodes × schema types) and does not survive
a third-party ecosystem.

Unknown nodes **throw** (`strict: true`), so a missing converter fails loudly in
CI rather than silently emitting empty markdown. An HTML-passthrough fallback
exists as an explicit opt-in for third-party nodes only.

### D2b — Ambiguity is resolved by normalization + typed claims, not predicate order

Predicates overlap far more widely than the four "hard" families suggest. A
`codeBlock` may be code or math via the `MATH_BLOCK_LANGUAGE` sentinel
(`pmBlockConverters.ts:80`); a paragraph containing one image may become
`block_image`, `block_video`, `block_audio`, or stay a paragraph
(`mdastMediaConverters.ts:38`); an `html` node may become video, audio,
`video_embed`, `html_block`, or `html_inline` (`mdastMediaConverters.ts:72`); a
`blockquote` may be an alert. Today the winner is decided by `if` order.

"First matching predicate wins" would encode that accident as the contract. Two
mechanisms replace it:

**1. Normalize raw mdast into semantic nodes first**, so the PM adapter dispatches
mostly on unambiguous types:

```text
blockquote        → alert | blockquote
paragraph/image   → video | audio | blockImage | paragraph
html              → video | audio | videoEmbed | html
```

This also makes registry 1 genuinely useful to other consumers — the content
server currently re-implements alert detection itself
(`vmark-content-server/src/render/remarkAlerts.ts:72`).

**2. Where competition remains, claims are typed and strength-ranked:**

```ts
type Claim =
  | { kind: "none" }
  | { kind: "claim"; strength: "exact" | "semantic" | "fallback"
      value: SemanticMdastNode; reason: string }
```

- `exact` — explicit syntax, tag, or provider match
- `semantic` — inference, e.g. media file extension
- `fallback` — ordinary paragraph/blockquote/html preservation, contributed
  explicitly, never a hidden default branch in the dispatcher

Recognizers are indexed by input mdast type. Exactly one claim at the highest
present strength must exist; **two claims at the winning strength are an error,
not an ordering contest**. `before`/`after` may order transforms but must never
silently resolve ownership. Diagnostics carry extension ID, node type, source
position, strength, and reason, and a dev/test trace API exposes every bid and
the winner.

**This is a Phase 1 deliverable, not a late one.** Deferring it until the hardest
nodes are reached would let the "mechanical" `codeBlock`, `paragraph`, and HTML
work bake in an accidental protocol first.

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

**Scope of the refutation (Codex review).** What is rejected is *runtime
composition* hierarchy: mermaid must not need privileged access to markdown's
internals, and markdown must not activate its children. Three other kinds of
hierarchy remain legitimate and are permitted — distribution bundles (installing
`markdown-plus` installs peer extensions), scoped configuration (a contributor
targets `markdown.fenceRenderer`), and lifecycle scope (disabling a host disables
contributions to extension points that no longer exist). The rule is therefore:

> Extensions are **flat runtime peers**; extension points are **host-owned and
> keyed**; bundles and dependencies may form a **validated DAG**.

Note also that a fence renderer serving markdown, table cells, and the source
pane does not make it host-independent — it contributes to several contracts,
and **each contribution must name its host extension point**.

Names live in one flat namespace. Rationale: qualified names would have to thread
through schema types,
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

### D6 — Gates measure adoption, are structural, and can fail CI

**The decisive lesson from the ADR audit (2026-07-22): three for three, this
project has shipped foundation-shaped dead code.** `useWorkspace()` (ADR-008,
**zero** production imports while 105 direct private-store reads persist),
`pluginsFor()` (ADR-011, zero callers), and `EditorHost` (ADR-010, exists only in
two comments) were each landed as an API surface, marked **Accepted**, and never
adopted. ADR-015 is proposing another foundation, so:

> **An acceptance gate must count adoption, never existence.** "The resolver
> exists" proves nothing. "N of N composition paths go through the resolver, and
> the count is asserted in CI" is the contract.

The counterexample proves it: **ADR-006 is the only ADR in the project with an
automated guard** (`spawnPty.test.ts:416` asserts `TERM_PROGRAM === "WezTerm"`),
and it is the one that survived untouched.

Two corollaries from the same audit:

- **Gates must be structural, not textual.** ADR-012's gate greps for
  `listen("menu:` — but `useUnifiedMenuCommands.ts:350` dispatches through a
  *variable* event id over an 88-entry map, so the grep reports a false green
  while a second router runs. Use dep-cruiser rules or call-site counts of the
  sanctioned entry point.
- **Anything an ADR declares deleted needs a CI gate on its name.** ADR-009
  deleted `editorStore.ts`; a later refactor (`7e721384`) re-created it for a
  different concept, and nothing caught it. It now has 220 references.

Every constraint gets a gate that goes red:

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
- **ADR-003 is preserved, not reopened.** Milkdown the framework stays rejected;
  only its per-extension conversion *pattern* is adopted, carried on Tiptap's own
  extension fields. D2's split keeps the markdown layer framework-independent —
  the property ADR-003 recorded as a benefit of the move — while ADR-001's
  engine-agnosticism actually improves, because the swappable adapter becomes a
  discrete registry instead of being fused into the pipeline.

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

**Dependencies that do NOT hold and must not be assumed**

The 2026-07-22 ADR audit (`dev-docs/audit/20260722-adr-reality-audit.md`)
checked all 14 ADRs against the code: **4 FALSE, 6 DRIFTED, 4 HOLD**. Of the
seams ADR-015 would naturally build on, most are not real: ADR-008 (workspace
facade) **FALSE**, ADR-009 **severely drifted** — `editorStore.ts` was
resurrected post-acceptance — ADR-010 **FALSE**, ADR-011 **FALSE**, ADR-012
(command bus) **drifted to near-false**. Only ADR-001, ADR-006, ADR-013 and
ADR-014 hold.

**ADR-007's slot system does not exist on either side.** `SlotDescriptor` is
declared in `plugins/registry.ts:47`, but `AppShell` exposes no registration API,
`PanelHost`/`OverlayHost` do not exist, and `App.tsx:224-246` hardcodes 15
overlays. `Contribution` must therefore **not** assume panel/overlay slots are
available; contributing a surface is out of scope until that seam is built. ADR-013 is the one this ADR most depends on, which is fortunate; but its
green "zero baseline entries" comes partly from relocating violations into
rule-level exemptions, so its boundary is greener than it is clean.

**Blocking sub-dependency: there are two disjoint command registries.**
`src/services/commands/` holds 49 `registerCommand()` sites; `src/plugins/actions/types.ts`
holds 83 `ActionId`s — with **no bridge** between them. VMark's entire editing
surface (bold, tables, headings, undo) lives in the second, so the Command
Palette cannot find "bold". Any extension API that lets a plugin "declare a
command" must choose: CommandBus gets it a palette entry but not a seat beside
the editing actions; `actionRegistry` gets the reverse. **This fork must be
resolved before D1's `Contribution` type can include commands**, and it is not
resolved here.

**Risk requiring action before any code**
- The corpus characterization harness runs against `testSchema.ts`, **not** the
  production schema, and that schema omits `toc`, `block_video`, `block_audio`,
  and `video_embed` (`testSchema.ts:123`). Converters return `null` for absent
  node types (`mdastBlockConverters.ts:210`, `mdastMediaConverters.ts:107,175`)
  and the orchestrator silently skips unknown mdast nodes
  (`mdastToProseMirror.ts:252`).
  *Precision (Codex review):* the current goldens do **not** encode a deletion —
  the corpus contains no `[TOC]`, video, audio, media-URL, or iframe fixture, so
  these constructs are simply never tested. The hazard is prospective: adding
  such a fixture without first fixing the schema would record the deletion as
  correct and stay green. That is still blocking, because Phase 0's whole job is
  adding those fixtures.

## Verification gates

- `set(registryEntries) === set(composedExtensions)` — contract test, red on drift
- No production file outside the pipeline imports a converter switch
- `grep -rE "case \"" proseMirrorToMdast.ts` returns 0 arms
- Corpus characterization runs on the production schema, with fixtures covering
  every custom syntax enumerated in the plan
- `plugin-isolation` severity is `error`; exemption count only decreases
- `nodeSafe.ts` invariant intact: registry 1 imports no ProseMirror, no DOM
  globals, no `@/` aliases; the `vmark-content-server` Node smoke test passes
- `pnpm check:all` green throughout
