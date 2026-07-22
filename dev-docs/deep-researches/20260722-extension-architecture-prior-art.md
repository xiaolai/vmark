# Extension Architecture — Prior Art

> Date: 2026-07-22 | Type: external prior-art research (primary sources only)
> Companion to `20260721-extension-architecture-investigation.md` (internal
> feasibility) and the internal serialization audit summarised in
> `dev-docs/plans/20260722-extension-architecture.md`.
> Question: how do mature editor systems (a) let a node own its own markdown
> serialization, (b) keep a plugin registry load-bearing, (c) order extensions
> declaratively, and (d) model "sub-extensions"?

## Verdict in one line

Of VMark's three architectural instincts, **two are confirmed by prior art and
one is refuted**: node-owned serialization is right (Milkdown proves it),
registry-as-composition is right (CodeMirror proves it), and **extension
hierarchy is wrong — every system examined flattens**.

## 1. Node-owned markdown serialization

**`prosemirror-markdown`** makes the dispatch table an injectable object rather
than control flow, but does not solve ownership — whoever constructs the
serializer still assembles the map:

```ts
new MarkdownSerializer(
  nodes: {[node: string]: (state, node, parent, index) => void},
  marks: {[mark: string]: MarkSerializerSpec},
  options: {strict?: boolean /* default true */}
)
```

Unknown nodes **throw** by default (`to_markdown.ts:220,284`).

**Milkdown solves ownership** by putting the converter on the ProseMirror
NodeSpec itself, so schema membership and serializer ownership are the same act:

```ts
export const headingSchema = $nodeSchema('heading', (ctx) => ({
  content: 'inline*', group: 'block',
  attrs: { id: {default: ''}, level: {default: 1} },
  parseMarkdown: {
    match: ({ type }) => type === 'heading',
    runner: (state, node, type) => {
      state.openNode(type, { level: node.depth }); state.next(node.children); state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'heading',
    runner: (state, node) => {
      state.openNode('heading', undefined, { depth: node.attrs.level })
      serializeText(state, node); state.closeNode()
    },
  },
}))
```

Dispatch never names a node (`transformer/src/serializer/state.ts`) — it scans
for the first spec whose `match` predicate accepts, then throws:

```ts
#matchTarget = (node) => {
  const result = Object.values({...this.schema.nodes, ...this.schema.marks})
    .find((x) => x.spec.toMarkdown.match(node))
  if (!result) throw serializerMatchError(node.type)
  return result
}
```

Two consequences: you cannot add a node without carrying its serializer (the
type demands it), and `match` being a **predicate** lets an extension claim by
attribute (`node.attrs.language === 'mermaid'`), which name-keying cannot express.

**Tiptap** offers the same shape two ways — officially in v3 via
`parseMarkdown`/`renderMarkdown` fields on the extension (built on **marked**,
not remark — a mismatch for VMark), and in the community `tiptap-markdown` via
`addStorage()`. Both derive the map by walking the same extension list that
builds the schema (`MarkdownManager.registerExtension`). `tiptap-markdown` adds
a detail worth stealing: **every schema node gets an HTML-passthrough default
first**, so an unregistered node degrades to inline HTML rather than vanishing.

## 2. Parsing direction — remark's three flat registries

A remark plugin does not hook a switch; it pushes into three arrays. `remark-gfm`
in full:

```js
export default function remarkGfm(options) {
  const data = this.data()
  ;(data.micromarkExtensions   ||= []).push(gfm(settings))            // syntax → tokens
  ;(data.fromMarkdownExtensions ||= []).push(gfmFromMarkdown())       // tokens → mdast
  ;(data.toMarkdownExtensions   ||= []).push(gfmToMarkdown(settings)) // mdast → text
}
```

`mdast-util-to-markdown` keys handlers by **mdast node type** and lets each
extension contribute its own escaping rules — important, because escaping is the
other thing that centralises into a god-function:

```ts
interface Options {
  handlers?: Record<Node['type'], Handle>
  extensions?: Array<Options>   // recursive: composite type == leaf type
  join?: Array<Join>
  unsafe?: Array<Unsafe>        // {character, inConstruct?, notInConstruct?, ...}
}
```

**Applicability:** VMark already uses remark, so this maps 1:1. But note VMark
sits between remark *and* ProseMirror, so it has **five** conversion boundaries,
not two. Any design modelling it as two will leak. Milkdown keeps `$remark` and
`$nodeSchema` as separate composables for exactly this reason.

## 3. Keeping a registry load-bearing

| System | Mechanism | Strength |
|---|---|---|
| **CodeMirror 6** | No manifest exists. `type Extension = {extension: Extension} \| readonly Extension[]`. Composition *is* the registry; nested arrays flatten and dedup by value identity; `Facet.define({enables})` lets a consumer declare "if anyone feeds me, install X". | **Strongest.** No second representation, so nothing can drift. If you did not return an `Extension`, you do not exist. |
| **VSCode** | `contributes` renders user-visible surfaces (command palette, menus) *from the manifest*, and since 1.74 declared commands auto-generate activation — you cannot run without being declared. | Medium. Docs describe **no** runtime check that a declared contribution is implemented; a declared-but-unimplemented command fails at invoke time. Packaging validates shape, not correspondence. |
| **Obsidian** | No contribution points at all — `manifest.json` is 9 fields of metadata. Everything is imperative `register*()` on the `Plugin` object, lifecycle-bound via `Component` so unload tears down. | Medium. Nothing decays because there is no metadata to decay. |

**The generalizable rule:** a registry survives only if it is the **sole path to
composition**, or the **sole source of a user-visible surface**. Metadata that
merely *describes* a hand-wired composition always rots, because nothing observes
the discrepancy. VMark currently has exactly the third configuration — manifest
plus hand-wired composition — which is the one combination guaranteed to decay.

Cheap honesty test either way: a contract test asserting
`set(registryEntries) === set(composedExtensions)`.

## 4. Ordering and dependency

| System | Mechanism | Notes |
|---|---|---|
| **CodeMirror 6** | `Prec.{highest,high,default,low,lowest}` — five named buckets, then position within bucket | Named buckets force justification; integers invite `priority: 1001` |
| **`@lezer/markdown`** | `BlockParser.{before,after}` naming a **peer parser**, plus `remove: string[]` | Best fit for genuinely pairwise constraints; auditable |
| **Tiptap** | integer `priority`, default 100, stable sort → **array order is already only a tiebreaker** | Trap: `ExtensionManager.plugins` reverses the array before sorting, `transformPastedHTML` does not. Direction is inconsistent per concern |
| **micromark** | binary `add: 'after'` (else prepend) | Coarse but sufficient at tokenizer level |
| **ProseMirror** | none — "in order of appearance" | The raw substrate; the ordering layer must be yours |

Because Tiptap already treats array position as a *tiebreaker*, VMark's 78-entry
hand-ordered array can be dismantled incrementally: replace one entry's implicit
position with an explicit `priority`/`before`/`after` plus a test, repeat. When
order no longer affects any test, sort alphabetically. 78 independent steps, not
a big-bang rewrite.

## 5. Sub-extensions — the refuted instinct

**Every system examined either flattens nesting immediately or never has it.**

- Tiptap: `addExtensions()` nests at authoring time, then `flat(10)` and warns on
  duplicate names — a single flat namespace.
- `@lezer/markdown`: `type MarkdownExtension = MarkdownConfig | readonly MarkdownExtension[]` — grouping is nested arrays of the *same type*, not a namespace.
- remark: `gfmFromMarkdown()` returns a **flat array** of five sub-extensions.
- Astro / Docusaurus: flat `integrations: []` / presets flattened.

And the three systems where markdown genuinely hosts foreign content all use a
**host-owned keyed registry contributed to by peers**, never a parent/child link:

| System | Extension point | Keyed by |
|---|---|---|
| `@codemirror/lang-markdown` | `codeLanguages` config parameter | fence info string |
| Obsidian | `registerMarkdownCodeBlockProcessor(language, handler)` | language |
| VSCode | grammar `injectTo` + `embeddedLanguages` | host scope name |

In Obsidian, a mermaid plugin is a **top-level plugin** that registers into an
extension point the markdown renderer owns. It is not a child of a markdown plugin.

**Verdict:** "sub-extension" conflates two separable things.

1. **Grouping for authoring/distribution** — "install markdown, get its standard
   pieces." Universally supported, universally implemented as *a function
   returning a flat list of same-typed values*. Cost near zero. Adopt.
2. **A hosted extension point** — "markdown owns fence dispatch; mermaid plugs
   in." Universally implemented as a keyed registry owned by the host, with
   contributors as peers.

Reasons hierarchy loses concretely: a fence highlighter is useful in markdown,
table cells, *and* the source pane — as a child of markdown it can serve only
markdown; a hierarchy requires the parent to exist before children register,
reintroducing the ordering problem one level up; and qualified names
(`markdown.mermaid`) would have to thread through schema types, commands,
settings keys, and i18n keys for no benefit.

**Reframing for VMark:** *markdown is an extension that declares an extension
point (fence-language dispatch); mermaid and sli.dev are peer extensions that
register into it.*

## Patterns to adopt

1. `toMarkdown`/`parseMarkdown` `{match, runner}` on the NodeSpec (Milkdown) — schema membership == serializer ownership
2. Predicate `match`, not name-key, for cases like fence-language claiming (index by name first, predicate-scan only for declared non-trivial matches)
3. Derive the serializer map by iterating the extension list; never author it
4. `strict: true` — unknown node throws, loud at test time
5. HTML-passthrough fallback as an opt-in escape hatch, so (4) still bites in CI
6. remark's three-registry contribution shape (`micromark` / `fromMarkdown` / `toMarkdown`)
7. Per-extension `unsafe` escaping rules
8. Uniform recursive type `Extension = Value | readonly Extension[]`
9. Dedup by value identity, so extensions declare dependencies by inclusion
10. Five-bucket `Prec`; named `before`/`after` for pairwise constraints; no integers
11. `Facet.enables` — dependency declared at the consumer end
12. Host-owned keyed extension points; contributors are peers
13. Grouping = a function returning a flat list
14. Lifecycle-bound registration (Obsidian `Component`) — design teardown in before the ecosystem exists
15. Contract test `set(registry) === set(composed)`

## Anti-patterns, with evidence

| Anti-pattern | Why | Evidence |
|---|---|---|
| Manifest describing a hand-wired composition | VMark's current state. No system does this. Metadata that does not *cause* composition has no observer. | CodeMirror has no manifest; VSCode's is the sole activation trigger; Obsidian's has zero contribution points |
| Nested extension namespaces | No prior art; forces qualified names everywhere; blocks multi-host contribution | Tiptap `flat(10)` + duplicate-name warning; `gfmFromMarkdown()` flat |
| Integer priority scale | Unbounded, unauditable, escalation-prone | Tiptap has it and still reverses arrays inconsistently to compensate |
| Array position as the ordering contract | ProseMirror's substrate offers nothing else | ProseMirror ref: handlers run "in order of appearance" |
| Adopting `@tiptap/markdown` wholesale | Built on **marked**, not remark — two parsers with divergent CommonMark conformance | `MarkdownManager` constructs `marked.Lexer` |
| A single conversion layer | VMark has five boundaries; collapsing them produces god-functions | Milkdown keeps `$remark` and `$nodeSchema` separate |
| Any side channel (`editor.addFeature()`) | One such API and the registry is advisory again — the mechanism by which VMark's registry died | CodeMirror: no `Extension`, no existence |

## Caveats

- VSCode's lack of declared-vs-implemented validation is asserted from the
  public docs; `vsce`'s validation source was not fetched. **Unverified.**
- Milkdown's `#matchTarget` is `Object.values(...).find(...)` per node — O(nodes ×
  schema types). Irrelevant at 24 node types, not at 200 with a third-party
  ecosystem.

## Sources

Primary sources, `main`/`master` at time of access (2026-07-22):

- prosemirror-markdown `src/to_markdown.ts`, `src/from_markdown.ts`; ProseMirror reference manual — https://prosemirror.net/docs/ref/
- Milkdown `packages/plugins/preset-commonmark/src/node/heading.ts`, `code-block.ts`; `packages/transformer/src/serializer/{state,types}.ts`; `packages/utils/src/composable/composed/{$remark,$node-schema}.ts`
- Tiptap `packages/core/src/helpers/{flattenExtensions,sortExtensions,resolveExtensions}.ts`, `packages/core/src/ExtensionManager.ts`, `packages/core/src/types.ts`, `packages/core/src/utilities/markdown/createBlockMarkdownSpec.ts`, `packages/markdown/src/MarkdownManager.ts`; https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension
- tiptap-markdown `src/serialize/MarkdownSerializer.js`, `src/util/extensions.js`
- CodeMirror 6 reference + system guide — https://codemirror.net/docs/ref/, https://codemirror.net/docs/guide/
- `@codemirror/lang-markdown` `src/index.ts`; `@lezer/markdown` `src/markdown.ts`
- micromark extensions README; `micromark-util-combine-extensions/index.js`
- remark-gfm `lib/index.js`; mdast-util-gfm `lib/index.js`; mdast-util-to-markdown README
- VSCode — Activation Events, Contribution Points, Syntax Highlight Guide (injection grammars)
- Obsidian `obsidian.d.ts`; obsidian-sample-plugin `manifest.json`
- Astro `packages/astro/src/types/public/integrations.ts`
