---
vmark:
  id: 019f758c-54ef-7043-93c8-921bc58c4c18
---
# Coherence & the Breakdown View

VMark's coherence layer keeps recursively developed writing projects
honest: it records **which documents each AI generation actually read**,
notices when those upstream documents change afterwards, and shows you —
on demand — exactly which downstream artifacts might now be out of date.
Nothing is ever auto-updated; you stay the editor-in-chief.

## How it works (30 seconds)

- **Provenance tracking is opt-in.** Turn on *Settings → Files & Images →
  Saving → Track document provenance* first. Until you do, VMark never
  writes to your files or creates `.vmark/`.
- Once enabled, every save, genie apply, accepted AI suggestion, MCP write,
  and workflow
  `save-file` step is recorded as a **transformation** in a plain-text
  ledger inside your workspace (`.vmark/` — git-friendly, human-readable
  JSONL; deleting the derived `index.db` loses nothing).
- When an AI writes a document while reading others, those reads become
  **dependency edges**, pinned to the revision that was read. In-app
  instrumented paths record `exact` inputs; MCP writes honestly record an
  `inferred` session-observed read set.
- When an upstream document advances past a pinned revision, the edge
  becomes **stale**. If two revisions evolved in parallel (e.g. on git
  branches), the edge is **diverged** — surfaced, never guessed at.
- Files edited outside VMark (terminal, other editors) are reconciled on
  scan as *observed external edits* — history stays gap-free, honestly
  marked as unknown-provenance.

## The Breakdown view

Open it from **Window → Breakdown** (or the command palette:
"Breakdown View"). It is strictly **pull-based**: it refreshes when you
open it or press refresh — it never nags in the background.

Items are grouped by artifact (the downstream document) and show the
upstream document, the pinned revision, and the current state:

| State | Meaning |
|---|---|
| `version-stale` | The upstream advanced past what this artifact was built from |
| `diverged` | The pinned and current revisions are parallel — no line of descent |
| `diverged-multi-head` | The upstream itself has parallel current versions |
| `waived` | You accepted the divergence, with a recorded reason |
| `unpinnable` | The upstream can't be resolved (e.g. an invalid pin) |

### Actions

Each item offers three honest actions — none of them rewrites history:

- **Accept newer** — records that the artifact is still compatible with
  the newer upstream (a *ratification*). The item leaves the list; if the
  upstream changes again, it comes back.
- **Revise** — opens the artifact so you can update it. Saving a new
  version retires the old edge.
- **Waive** — records an intentional divergence with a **required
  reason** (unreliable narrators exist). In v0, a waiver is intentionally narrow: it applies only to this edge and the specific upstream revision it resolves against. Waived items stay visible,
  marked distinctly, and reopen if the upstream moves again.

Accept-newer and waive are disabled when the upstream has multiple
current versions — there is no single revision to resolve against;
revise (or reconcile the versions) first.

## Semantic checking, claims, and contexts

Version staleness says an upstream *moved*; semantic checking says whether
that movement actually *contradicts* the derived document. Checks are
**pull-only**: press **Check** on a stale edge and VMark asks your
configured AI provider to compare the pinned upstream revision, the
current one, and the derived text. The verdict lands as a badge — *checked
valid*, *contradicted* (always with a verbatim evidence quote), or
*unchecked* when the model was unsure, timed out, or answered below the
confidence bar. Unknown is honest, never hidden. A check expires the
moment either document moves again — or the claim set changes.

**Canon claims** are facts you have made explicit ("Elena is
left-handed"). Select text in a document and run *Extract Claim from
Selection*: the claim is born a **draft** with provenance (which document,
which revision). Promote it to **established** when it becomes canon —
only established claims are fed to semantic checks. Correcting or retiring
a claim appends history; nothing is ever deleted. Hiding a claim in a
context is reversible visibility, not retirement.

**Contexts** are named views of the workspace (the *default* context is
always there). Each context selects what "current" means and which claims
apply; a child context inherits its parent's claims additively. Contexts
are **greenhouse** by default — check verdicts read as advisory tension.
Flipping one to **enforcing** (an explicit, confirmed act) labels
contradictions as canon violations. The Breakdown's context picker chooses
which context you are looking through; check results are bound to the
exact context and claim snapshot that produced them and never leak across.

## Provenance, delegation, and branches

Three things keep the coherence layer honest as a project actually
evolves — none of them nag, all of them are pull-only.

**Provenance recovery.** When you edit a derived document by hand (in
VMark or an external editor), the edit correctly loses its recorded
inputs — the old dependency edges no longer describe the new text. The
Breakdown's *Provenance unknown* group offers to restore them: press
**Suggest inputs** and VMark proposes the document's most recent prior
input set (roles preserved), pre-checked and editable. **Confirm
provenance** re-attaches the edges to the current version without
creating a new revision, so the document's own downstreams never see a
spurious change. Documents that never had inputs are never listed —
there is nothing to recover and nothing to nag about.

**Agent delegation.** By default only you can resolve stale edges. If
you want an AI agent to accept-newer or waive on your behalf (through
the `coherence_resolve` MCP tool), grant it a **time-limited
delegation** from the Breakdown: name the agent, choose the scope
(accept-newer and/or waive), set an expiry (7 days by default, never
"forever"). Every delegated resolution is recorded against the grant, so
the audit trail always shows who acted under whose authority. Revoke any
grant with one click. Canon claims and contexts stay human-only — an
agent can never promote a claim or enforce a context.

**Branch contexts.** A context can be mapped to a git branch. When you
check out a mapped branch, the Breakdown shows a **candidate chip**
offering to switch — it never switches on its own. If the branch has no
context yet, the chip offers to create one named after it. When a real
(non-fast-forward) merge lands, a dismissible banner nudges you to
review the Breakdown; the divergence and staleness it surfaces are the
normal Breakdown states, so nothing new runs — you just get walked to
the review.

## Frontmatter identity

Once provenance tracking is enabled, the first time a file is captured
VMark adds a small identity block to its frontmatter:

```yaml
vmark:
  id: 018f3c7a-9f2e-7cc1-b302-5e9d4a6b21c7
```

This ID is how a document keeps its history across renames and moves. It
never affects content hashing (adding it doesn't create a "change"), and
everything else in your frontmatter is left untouched. If you copy a
file, the duplicate ID is detected and surfaced for you to resolve —
never auto-fixed.

If you would rather VMark never touch your files, leave *Track document
provenance* off — that is the default.

## Git interoperability

- `.vmark/` ledger files are git-tracked and merge cleanly across
  branches (append-only, `merge=union`).
- Checkouts, branch switches, and resets are recognized as **navigation**
  — they never create phantom revisions.
- `git revert` and merges that mint new content are captured as
  git-attributed transformations.
- The derived index (`index.db`) is gitignored and rebuilt from the
  plain-text ledger whenever needed.

## For AI agents (MCP)

External agents can query coherence state through the
[`coherence` MCP tool](/guide/mcp-tools#coherence) (`status`, `edges`,
`claims`, and `contexts` actions), for workspaces you have opened in
VMark. `status` is a pure read; `edges` reconciles first — it may append
provenance records to the workspace's own ledger, but never touches your
documents. The tool declares `readOnlyHint: true`, so a client may
auto-approve it.

Resolution (ratify/waive) lives in a **separate** tool,
[`coherence_resolve`](/guide/mcp-tools#coherence-resolve), and stays with
the human by default: an agent can only call it after you grant that
specific agent a time-limited delegation, and every resolution is
audit-logged against the grant. Keeping it out of `coherence` is what
lets the read tool be auto-approved without an agent silently acquiring
the ability to write to your ledger.

Canon claims and contexts are never mutable over MCP at all.
