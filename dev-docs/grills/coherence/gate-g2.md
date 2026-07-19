# Gate G2 — Git Operation Classification (WI-0.4)

- **Traces:** R18, G2 (paper §8; `dev-docs/plans/20260718-coherence-layer.md`)
- **Probe:** `probes/g2-gitops.mjs` (Node, zero deps) — results in
  `probes/g2-results.json`
- **Environment:** macOS (darwin 25.5.0), git 2.50.1 (Apple Git-155),
  Node 26.5.0. All probe repos created in fresh `mktemp`-style temp
  directories; nothing ran inside the vmark repo.

> Status: **PASS** — all 12 scenario rows classified correctly on macOS

## Purpose

R18 requires that git *navigation* (checkout, branch switch, reset-style
tree jumps) never mints revisions, while `git revert` and merge commits are
*mutations* captured as git-attributed transformations. Failure here
pollutes an append-only ledger permanently, so this is a go/no-go gate: a
candidate classifier must get every scenario right using **only observable
state**, with no event stream from inside `.git`.

## The watcher blind spot (why scan-time reconciliation)

`src-tauri/src/watcher.rs` lists `.git` in `IGNORED_DIRS` — **no
`.git/HEAD` events ever reach VMark**, and R18 already notes that
`.git/HEAD` watching would be insufficient anyway (worktrees indirect
through a `.git` *file*, events can be missed while the app is closed).
The probe therefore validates classification purely as a **reconciliation
problem**: take a snapshot of observable state, let the operation happen,
take a second snapshot, classify from the pair. Every row below was decided
this way; no inotify/FSEvents data was used.

## Observables (per snapshot)

| Observable | How obtained | Notes |
|---|---|---|
| Repo presence | `.git` dir/file exists and `git rev-parse --git-dir` succeeds | `NOT_GIT` otherwise |
| Raw HEAD content | Manual read of `<gitdir>/HEAD`, resolving `gitdir: <path>` indirection for linked worktrees | Distinguishes ref switch at same sha |
| Resolved HEAD sha | `git rev-parse HEAD` | |
| Symbolic ref / detached | `git symbolic-ref -q HEAD` (fails ⇒ detached) | |
| Known-commit set | `git rev-list --all HEAD` | `HEAD` included so detached states are covered |
| `MERGE_HEAD` presence | Manual read from per-worktree gitdir | The only reliable mid-merge tell |
| `ORIG_HEAD` | Manual read | Corroborative only (see edge cases) |
| Reflog tail | `git reflog -1 --format=%gs` | Attribution/op naming only, not primary |
| Worktree fingerprint | Hash of all non-`.git` file contents | Shows whether git changed files |

## Classifier algorithm (precise)

Given `before` and `after` snapshots of one workspace directory:

```
classify(before, after):
  1. if after has no git repo                          → NOT_GIT
  2. if after.MERGE_HEAD exists                        → MERGE_IN_PROGRESS
  3. created = after.knownShas − before.knownShas
     if after.headSha ∈ created                        → MUTATION
  4. if after.headSha ∈ before.knownShas:
       if headSha unchanged AND raw HEAD unchanged     → NO_OP
       else                                            → NAVIGATION
  5. else                                              → EXTERNAL_UNKNOWN
```

- **MUTATION** = HEAD landed on a commit that did not exist before the
  operation: git minted real new content (revert, merge commit). Ledger:
  `transformation` with `agent: {type: "git", id: <op from reflog>}`.
- **NAVIGATION** = HEAD landed on a pre-existing commit (checkout, branch
  switch, `reset --hard`, detach, worktree checkout, fast-forward merge).
  Ledger: `navigation` entry (§5.4.2) — never mints revisions.
- **MERGE_IN_PROGRESS** = git has rewritten working files (conflict
  markers) but minted no commit; capture must be deferred until the merge
  concludes (then step 3 classifies the resolution commit as MUTATION).
- **EXTERNAL_UNKNOWN** = HEAD is on a sha the previous observation never
  knew (e.g. `git fetch` elsewhere + checkout while VMark was closed) —
  scan-reconcile file contents as external edits.
- **NOT_GIT** = plain workspace; every change is an ordinary external edit.

Step ordering is load-bearing: the MERGE_HEAD check must precede the sha
tests (mid-conflict, HEAD is unchanged and would otherwise read as NO_OP
despite git having rewritten files), and step 3 must precede step 4 (a
merge commit's parents all pre-exist).

## Expected vs. observed matrix

12/12 rows correct (`probes/g2-results.json`, generated 2026-07-18):

| # | Scenario | Expected | Observed | Pass |
|---|---|---|---|---|
| 1 | Checkout of older commit (detached HEAD) | NAVIGATION | NAVIGATION | ✅ |
| 2 | Branch create + switch (`git switch -c`) | NAVIGATION | NAVIGATION | ✅ |
| 3 | `reset --hard` to older commit | NAVIGATION | NAVIGATION | ✅ |
| 4 | `git revert` | MUTATION | MUTATION | ✅ |
| 5 | Fast-forward merge | NAVIGATION | NAVIGATION | ✅ |
| 6 | True merge commit, no conflict | MUTATION | MUTATION | ✅ |
| 7 | Merge with conflict — mid-conflict scan | MERGE_IN_PROGRESS | MERGE_IN_PROGRESS | ✅ |
| 8 | Merge with conflict — after resolution commit | MUTATION | MUTATION | ✅ |
| 9 | Worktree add — independent HEADs, `.git`-file indirection readable | INDEPENDENT | INDEPENDENT | ✅ |
| 10 | Checkout (detach) inside a linked worktree | NAVIGATION | NAVIGATION | ✅ |
| 11 | Rescan with no operation in between | NO_OP | NO_OP | ✅ |
| 12 | No-git workspace, external edit between scans | NOT_GIT | NOT_GIT | ✅ |

## The fast-forward merge decision

The classifier reports **NAVIGATION**: HEAD landed on `b`'s tip, a sha
that already existed in the before-set; zero new shas were minted. But the
working files *did* change to content this checkout had never displayed.
Observed distinguishers vs. a plain checkout:

| Observable | FF merge | Plain checkout |
|---|---|---|
| Reflog subject | `merge b: Fast-forward` | `checkout: moving from …` |
| `ORIG_HEAD` | set to pre-merge sha | not set |
| Branch ref | unchanged (`refs/heads/main`) while sha moved | ref changed or detached |
| New shas minted | 0 | 0 |

**Recommended handling (matches the paper):** treat as navigation to
existing revisions **iff** the post-operation file contents hash to
revisions already known in the ledger (the usual case: the other branch's
content was captured when it was written). If any file's content hash is
unknown to the ledger, fall back to scan reconciliation as external edits
(observed-external transformation, `confidence: "unknown"`, per spec §8) —
never invent a git mutation for content git did not mint.

## Edge cases discovered

1. **Mid-conflict merges are invisible to sha observables.** During an
   unresolved merge, HEAD sha and raw HEAD are unchanged and the **reflog
   is not yet written** (still shows the previous commit) — yet git has
   rewritten files with conflict markers. `MERGE_HEAD` presence is the only
   reliable tell; the classifier checks it first and the reconciler must
   defer capture until the merge concludes (commit or abort).
2. **`ORIG_HEAD` is corroborative, never primary.** It was null after a
   plain checkout, set after merge/reset as documented — but also
   unexpectedly set after `checkout --detach` inside a linked worktree
   (residue of `git worktree add` machinery). Use it for attribution hints
   only.
3. **Branch create + switch moves nothing but raw HEAD.** Same sha, no
   file changes; only `.git/HEAD`'s symbolic content differs. The
   classifier must compare **raw HEAD content**, not just the resolved sha,
   or this reads as NO_OP (harmless for revisions, but the `navigation`
   entry and branch↔Context mapping would be lost).
4. **`reset --hard` shrinks the known-sha set.** The abandoned commit
   disappears from `rev-list --all` (reachable only via reflog). The
   classifier must test `after.headSha ∈ before.knownShas` and must not
   assume the set grows monotonically. Ledger impact: none — revisions are
   content-addressed and already captured.
5. **Linked worktrees indirect through a `.git` file.** Verified:
   `.git` is a file `gitdir: <main>/.git/worktrees/<name>`; HEAD,
   MERGE_HEAD and ORIG_HEAD live in that per-worktree gitdir; manual
   resolution works; `rev-list` works from inside the linked worktree
   (shared object db). "Switching worktrees" is workspace switching — each
   worktree carries its own independent HEAD and is observed separately;
   no git operation occurs in either repo.
6. **Detached HEAD is representable, not exceptional.** Raw HEAD becomes a
   bare sha and `symbolic-ref` fails; classification is unaffected.

## Recommended reconciliation design for WI-1.7

1. **Persist the last observed git state per workspace** in the SQLite
   index (derived, rebuildable — R16): raw HEAD content, resolved HEAD
   sha, and the known-sha set (or a compact digest of it; prose-repo scale
   makes the full set cheap). This is the `before` snapshot for the next
   scan.
2. **On every scan** (watcher batch quiesced, workspace open, window
   focus): take the `after` snapshot, run the classifier above.
   - `NO_OP` → nothing.
   - `NAVIGATION` → append one `navigation` entry (§5.4.2) with `op` taken
     from the reflog subject (`checkout` / `reset` / `branch-switch` /
     `detach` / `worktree-switch`); its `idem` coarse-time recipe already
     dedupes double observation. No revisions minted.
   - `MUTATION` → snapshot the new content (spec §5.2 ordering: CAS write
     before ledger append), then append a `transformation` with
     `agent: {type: "git", id: <op>}`; inputs are the parent revisions when
     the parents' content hashes are known to the ledger, else the entry
     honestly carries `confidence: "unknown"` with an empty input set.
   - `MERGE_IN_PROGRESS` → defer: mark the workspace "merge pending" and
     re-run reconciliation when MERGE_HEAD disappears. Do not capture
     conflict-marker content as anyone's revision.
   - `EXTERNAL_UNKNOWN` / FF-merge-to-unknown-content → scan reconcile:
     per-file, if content hash matches a known revision → navigation to it;
     else observed-external transformation, `confidence: "unknown"`.
   - `NOT_GIT` → ordinary external-edit reconciliation (R9); no git
     entries of any kind.
3. **Never rely on `.git` file events** — the watcher keeps ignoring
   `.git` (correct: event storms during rebase/gc), and this gate shows
   scan-time reconciliation needs none of them.

## Reproduce

```bash
node dev-docs/grills/coherence/probes/g2-gitops.mjs        # KEEP=1 to keep temp repos
```
