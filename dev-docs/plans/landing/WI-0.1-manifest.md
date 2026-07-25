# WI-0.1 — Verified landing manifest (hunk/file granularity)

Built from **actual diffs** (`git diff-tree`), not commit subjects. Source data:
`manifest-raw.tsv` (the 54 commits in `v0.9.7..6b7f1459`: **51 refactor landing units**
= `v0.9.7..cc89b450` + 3 session-apparatus doc commits — Zed research, ADR fold, landing
plan; the still-later Phase-0 doc commit `2135bc79` is also apparatus, not a unit).

## Key finding: cross-unit commits split at FILE boundaries, not intra-file hunks

Codex feared hunk-level entanglement. Inspection of the four cross-unit commits shows each
touches **disjoint files per landing unit** — so the split is a clean `git checkout <commit>
-- <files>`, not `git add -p` surgery. The **only** intra-file case is `package.json` (three
gate commits each append a different `scripts` entry). Everything else is file-clean.

| Commit | Units it spans | Split |
|---|---|---|
| `faec8620` | gate-config + security(Rust) | files: `src-tauri/**` → security; `.dependency-cruiser*`, `scripts/check-extension-budget.mjs`, `scripts/extension-budget.json`, `package.json`(hunk) → gate |
| `a6ebf4e1` | security + nucleus + fence + pipeline-registries | files: `src-tauri/**` → security; `src/lib/extensions/**` + `src/utils/markdownPipeline/*.registry.ts`,`*ToProseMirror.ts`,`*ToMdast.ts` → nucleus; `src/plugins/codePreview/**` → fence |
| `87c0e2ee` | docs + gate(deleted-name) | files: `dev-docs/decisions/**` → docs; `scripts/check-deleted-names.mjs` + `package.json`(hunk) → gate |
| `732ba97c` | safety-net + docs | files: `src/**` (corpus/golden/schema) → safety-net; `dev-docs/plans/**` → docs |

## Landing units (every final-branch hunk assigned; none falls through)

| Unit | Commits / file-subsets | Phase | Notes |
|---|---|---|---|
| **U1 safety-net** | `1eaf1db1`, `732ba97c`(src only) + new WI-0.2 harness | 1 | pure test/golden/schema; reads only |
| **U2 security** | `faec8620`(`src-tauri/**`) + `a6ebf4e1`(`src-tauri/**`) = final guard state | 1 | Rust; behavior change (rejects bad `cli_path`) |
| **U3 d1-d4** | `f8767c57`, `526e1434`, `5483267c`(header sync) | 1 | semantic reconstruction on v0.9.7 (WI-0.5) |
| **U4 docs** | all doc-only commits + doc hunks of cross-unit commits | 1 | rewritten as target-vs-shipped snapshot |
| **U5 jscpd** | `1ea49a30` | indep | infra; `.jscpd.json`+`package.json`+lock |
| **U6 service-tier** | `c41cb916` (137 files, precedes core) | indep | big; one conceptual unit |
| **U7 perf-bench** | `4b8a658b` | indep | `src/bench` only |
| **U8 fence** | `870449b9`→`2a84e376` + `a6ebf4e1`(`codePreview/**`) | indep | ordered pair + corrections |
| **U9a format-contract body** | `a870a535`,`43a60416`,`dd1c6f01`,`3c04a99d`,`f8292c88`,`ebc86ca0` | **2 (core-coupled)** | WI-0.5 proved: conflict on resolver-shared files / need `FormatConfig.toPlainText` |
| **U9b svg + closeSave-dup** | `8edfe830`, `da53f8c6` | indep | the only parts of the old U9 that split out clean (WI-0.5) |
| **U10 nucleus** | `67bf4be1`,`05b0457e`,`8d9bfbbe`,`1b532bf3`,`82a8f35c`,`b1f81f2a`,`fb5cf735`,`d6fb977d`,`e5295559`,`54048c6f`,`f64f99d5` + `a6ebf4e1`(core+registry files) + header syncs `2b0af5f3`,`f9e184e7`,`c86b76e6` | 2 | serialization/composition inversion — interdependent |
| **U11 gates-pre-core** | `faec8620`(config), `cd5db8f4`, `9fcb7dd0` | 1 (with safety-net) | baselines authored to pass pre-core — WI-0.4 confirms |
| **U12 gate-post-core** | `87c0e2ee`(`check-deleted-names.mjs`+`package.json`) | 2 (with nucleus) | forbids files `f64f99d5` deletes |

## `package.json` hunk map (the one intra-file split)

`package.json` `scripts` entries added by: `1ea49a30` (jscpd `dup`), `faec8620`
(extension-budget), `87c0e2ee` (deleted-names). Each lands with its own unit; reconstruct by
adding the specific script line, not by checking out the whole file.

## Open independence questions — RESOLVED by WI-0.5 (see `phase-0-findings.md`)

- **U9 format-services is NOT one independent slice.** `43a60416`/`dd1c6f01`/`3c04a99d`
  conflict on resolver-shared files (`sourceEditorExtensions.ts`, `formats/adapters/markdown.tsx`,
  `types.ts`); `f8292c88` needs `FormatConfig.toPlainText` from the format-contract cluster.
  → the format-contract body (`a870a535`,`43a60416`,`dd1c6f01`,`3c04a99d`,`f8292c88`,`ebc86ca0`)
  is **core-coupled → Phase 2**. Only `8edfe830` (svg) and `da53f8c6` (closeSave-dup) split out
  of U9 as genuinely independent.
- **Proven independent set** (clean cherry-pick onto v0.9.7 + `tsc` green): U5 jscpd,
  U1 harness, U6 service-tier, U7 perf-bench, U8 fence, `8edfe830` svg, `da53f8c6` closeSave-dup.
- **U10 `f64f99d5`** stays with the nucleus (the deleted-name gate U12 enforces its deletions;
  not separately reconstructed — no benefit to isolating a dead-code deletion from the core
  that supersedes it).
