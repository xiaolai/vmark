# Extension-Architecture Goal Audit — measured progress vs. the stated goal

> Date: 2026-07-25 | Branch: `refactor/vmark-core` @ `d4379cec` (192 commits
> ahead of `main`) | Method: read-only measurement against the working tree and
> `git merge-base main HEAD` (`1eaf1db1`). Every number below is reproducible
> from the commands in the last section.
> Trigger: "how well are we doing?" against the goal *minimal core, every
> feature outside core extensible as a plugin*.

## Verdict

**The refactor delivered real correctness value and one real structural
inversion. The binding constraint on the stated goal went unmeasured and
unmoved.**

Not "nothing useful" — the delta table below is unambiguous. But the axis that
improved (plugin↔plugin coupling) is not the axis that gates the goal
(plugin↔store coupling), and only the former has a gate.

## Delta across the 192-commit branch

| Measure | `main` | HEAD | Change |
|---|--:|--:|---|
| `proseMirrorToMdast.ts` hand-written `case` arms | 24 | **0** | inverted to registry dispatch |
| Dead `manifest.ts` stubs (ADR-011) | 77 | **0** | scaffolding deleted |
| Cross-plugin import statements | 339 | **264** | −22% |
| Plugin files importing anything from `@/` | 293 | **218** | −26% |
| Characterization corpus files | 26 | **46** | +77% |
| **Plugin files importing `@/stores/`** | **97** | **98** | **+1** |
| `pmInlineConverters.ts` `case` arms | 9 | 9 | unchanged (central by design, WI-1.6) |

The last two rows are the finding. Cross-plugin coupling is a tidiness problem;
a plugin importing `@/stores/tabStore` is what makes it unshippable as
third-party code. The improved axis is the one `dependency-cruiser` could
already see. The gating axis has no gate.

## What is genuinely done

1. **Serialization inversion (Phase 2).** 24 → 0 case arms, verified. Adding a
   node type no longer requires editing a central switch. This is the hard part
   of the whole program and it is real.
2. **Four shipping data-loss defects found and two fixed.** Widening the corpus
   surfaced D1 (`![A short clip](clip.mp4)` → `![](clip.mp4)`), D2 (link titles
   dropped), D3 (`==highlight with **bold**==` destroyed by escaping), D4
   (escaped `\^` re-parsed as superscript). All autosave-persisted. The test
   suite had been *certifying* the loss: `testSchema` omitted four node types,
   so goldens encoded deletion as correct. D1/D2 verified fixed at HEAD.
   **This value is independent of extensibility and justifies the work alone.**
3. **A fake foundation deleted, not extended.** 77 manifest stubs removed after
   verifying `pluginsFor()` had zero callers — the opposite of the pattern the
   ADR reality audit identified.
4. **Gates that count adoption, not existence** (`adoption.test.ts`,
   `check-extension-budget.mjs`), and `plugin-isolation` promoted to `error`.

## Defect found: the adoption gate has the blind spot it was built to catch

`src/lib/extensions/adoption.test.ts` reports **0** composition roots bypassing
the resolver. That is wrong — not stale, structurally blind.

`src/export/createExportExtensions.ts` is a **live production composition root**
(`src/export/ExportSurface.tsx:63`) that hand-wires `StarterKit`, `Link`, and 16
plugin imports, with **zero** `resolveExtensions` calls. It is absent from
`BYPASSING_COMPOSITION_ROOTS`, so the gate cannot see it.

The gate's second test guards against *deleting* entries from the list. Nothing
forces a root that was never listed to be added. This is the exact
"the file exists is zero evidence" failure the 2026-07-22 audit named, recursed
one level up into the gate itself.

**Fix options:** add the file to the list (gate then correctly reports 1), or —
better — derive composition roots by scanning for `StarterKit` imports so a
fourth root cannot appear unnoticed.

## Distance to the goal, by dimension

| Dimension | State | Evidence |
|---|---|---|
| Features live in plugin directories | ✅ | 84 dirs |
| Composition routes through a registry | 🟡 2 of 3 roots | export root bypasses |
| Plugins are self-contained | 🔴 19% | 16 of 84 have no `@/` imports |
| Plugins self-register | 🔴 0% | only 2 files declare `VMarkExtension` |
| Core is minimal | 🔴 | `stores` Ca=767, `utils` Ca=750 |
| Plugin can contribute what a feature needs | 🔴 4 of ~9 kinds | `types.ts:72` |
| Third-party plugins possible | 🔴 | no isolation boundary (ADR-016) |

`Contribution` admits exactly `tiptap`, `codemirror`, `markdown`, `pmAdapter` —
all *editor node/mark* concerns. It cannot carry commands, panels, overlays,
keybindings, settings, menu items, or translations. **"Extension" today means
"a markdown node type", not "a feature."** Terminal, browser, workflow viewer
and AI genies could not be extensions under this contract, and the contract
correctly says so rather than pretending otherwise.

## Confirmed and refuted claims

| Plan claim | Status |
|---|---|
| Phase 2 DoD: `grep -cE 'case "' proseMirrorToMdast.ts` → 0 | ✅ **confirmed** |
| WI-3.3: registry + 77 manifest stubs deleted | ✅ **confirmed** (0 remain) |
| WI-1.7/1.8: `plugin-isolation` is `error`, budget ratchets | ✅ **confirmed** (7 known) |
| WI-3.5 / adoption gate: "zero bypassing composition roots" | ❌ **refuted** — export root uncounted |
| Budget note: 22 `pathNot` entries mask ~194 violations | ✅ **confirmed** — measured **203** total |
| Phase 4B deferred DoD: files importing `markdownPipeline` | 🟡 28 today (plan said 34) |

## Caveats and limits of this audit

- **Scope:** static measurement only. No runtime behaviour was exercised; the
  E2E journey suite and `pnpm check:all` were not re-run for this audit.
- **Coupling counts are import-statement counts**, not weighted by how load-
  bearing each import is. A `@/utils/debug` import and a `@/stores/tabStore`
  import count the same in the `@/` totals; the store row is broken out
  precisely because they are not equivalent.
- **The 203-violation figure** comes from a config with the `plugin-isolation`
  `from.pathNot` array emptied. Some of those 22 exemptions encode reviewed
  design intent (coordination plugins are cross-cutting by design), so 203 is
  the *unexempted* count, not 203 bugs.
- **Deferral of WI-5.2–5.5 is not counted against progress.** ADR-016's argument
  — no caller principal can exist inside a single JS context, so the broker
  cannot precede isolation — was checked and holds. Building those now would
  have produced a fifth unadopted foundation.
- **zsh measurement trap:** `git show $BASE:path` silently mis-parses, because
  zsh treats `$VAR:s...` as a history modifier and mangles the path. It returns
  empty, and `grep -c` on empty output reports `0` — a false "already migrated"
  reading. Use `git show "${BASE}:path"`. One delta line in this audit was
  initially wrong for this reason before being caught and re-measured.

## Recommended next slice

A ratcheting gate on plugin→store imports, mirroring
`scripts/check-extension-budget.mjs`, baselined at the current **98**. This makes
the goal's binding constraint visible for the first time; today nothing prevents
it from growing, and it did grow (97 → 98) across a 192-commit refactor whose
stated purpose was decoupling.

## Reproduction

```bash
BASE=$(git merge-base main HEAD)

# switch arms (note the braces — see caveats)
git show "${BASE}:src/utils/markdownPipeline/proseMirrorToMdast.ts" | grep -cE 'case "'
grep -cE 'case "' src/utils/markdownPipeline/proseMirrorToMdast.ts

# plugin coupling deltas
git grep -h 'from "@/plugins/' "$BASE" -- 'src/plugins/**/*.ts' 'src/plugins/**/*.tsx' | wc -l
git grep -l 'from "@/stores/'  HEAD   -- 'src/plugins/**' | grep -v '\.test\.' | wc -l

# true cross-plugin violation count (empty plugin-isolation from.pathNot first)
pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type err   # 7 (exempted)

# composition roots that never call the resolver
grep -rln StarterKit src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' \
  | xargs grep -Ln resolveExtensions
```
