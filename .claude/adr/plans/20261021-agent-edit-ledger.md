# Decisions — Agent edit ledger (#1591)

> Plan: `dev-docs/plans/20261021-agent-edit-ledger.md` — a maintainer-local plan that is not tracked.
> Built: the agent edit journal (`src-tauri/src/agent_journal/`, `src/services/agentJournal/`) and its history panel (`src/components/McpHistory/`).
> Defines: ADR-AL1, ADR-AL2, ADR-AL3, ADR-AL4, ADR-AL5, ADR-AL6, ADR-AL7, ADR-AL8, ADR-AL9, ADR-AL10, ADR-AL11, ADR-AL12, ADR-AL13, ADR-AL14, ADR-AL15. These ids are local to this plan: a comment that cites one of them
> next to code this plan built means the decision below, not the repository-wide
> `ADR-NNN` of a similar number.
>
> The text below is the plan's own, unedited, except bullets marked as added after the plan. It is a record of what was decided then; paths and
> work-item ids in it are as of the plan and may have moved since.

- **ADR-AL1 — Git is export, not the store.** Maintainer decision. An
  app-owned bare repository remains a candidate *backend* (ADR-AL3), never the
  user's branch.
- **ADR-AL2 — Checkpoints evolve into the journal; the coherence ledger is not
  the store.** The ledger is workspace-scoped, skips untitled documents,
  records saves rather than mutations, and captures fire-and-forget. It stays
  an optional workspace projection.
  - *Recorded limitation, added after the plan (degraded-queue scheduling,
    `src-tauri/src/agent_journal/degraded_drain.rs`):* If a drainer thread
    cannot start and its single inline retry also fails, retryable work
    remains armed without an autonomous timer. A later ensure call may retry
    it inline or start a drainer; an existing drainer may adopt it after
    finishing its current document. Status and history reads do not trigger
    recovery. Until a queued record is appended successfully, it is not
    durable. Process exit loses memory-only queued records; startup marks any
    durable unmatched prepared transaction uncommitted and does not
    reconstruct its queued postimage. Queued documents continue to refuse
    controlled mutations.
- **ADR-AL3 — Journal backend chosen by measurement, with a hard admissibility
  rule.** The backend must capture durably on a machine without system Git.
  A bare-Git backend is admissible only via a bundled implementation or with a
  JSONL fallback that is itself the durable store. Decided in Phase 0 by
  spike numbers.
- **ADR-AL4 — Actor model.** `actor` is a union: `human`, `mcp`, `system`
  (e.g. retention, migration), `legacy` (pre-journal entries, attribution
  unknown). `mcp` carries `principal` (the four Rust states, kept distinct —
  never collapsed to "unknown"), `connectionId` (UUID minted per authenticated
  connection, not the restarting counter), optional `sessionLabel` (declared
  by the client at `identify`, untrusted, ≤ 128 UTF-8 bytes, display and
  grouping only), and the untrusted display name kept separate from the
  credential-derived principal. The content author is recorded separately
  from the persistence initiator (a `workspace.save` by an agent can persist
  human edits).
- **ADR-AL5 — Journal domain is canonical editor text.** Revisions are over
  the canonical Markdown the editor holds (the buffer after
  `writeContent`/serialization), so buffer-only mutations are recordable
  without a save. Physical disk bytes (EOL, BOM, trailing newline) are stored
  as separate per-save metadata, never as the revision content.
- **ADR-AL6 — Two transaction classes.**
  - **Per-document linearity.** Every record carries a transaction id;
    every *linearized* revision record also carries the parent revision it
    was built on (a `pendingObservation` has no revision parent yet — see
    below). The single Rust writer is the only
    place a document's head advances, and it owns a per-document reservation:
    `prepare` is accepted only when no unresolved transaction holds that
    document and the stated parent equals the current head (compare-and-swap);
    otherwise it is refused with `JOURNAL_BUSY` or `STALE_PARENT`, nothing
    changed. The reservation is released by `aborted`, `committed` or
    `uncommitted`. Two windows can therefore never commit sibling revisions.
    Every append (controlled or observational) is a CAS on the head; a
    mismatch returns the current head so the caller can recompute.
  - **Terminal-append failure.** If `aborted`, `committed` or `discarded`
    cannot be appended, the document enters degraded state: the
    reservation is kept, the terminal record is retried from the in-memory
    queue, the status is visible, controlled mutations on that document are
    refused with `JOURNAL_DEGRADED`, and observational captures wait in the
    queue. A failed `aborted` still answers the MCP request with its refusal
    (nothing was mutated). Restart turns any still-unresolved `prepared` into
    `uncommitted`: the reservation is released, and the preimage blob stays
    pinned until a `committed { resolves }` or `discarded` names it.
  - **Resolving `uncommitted`.** Discard takes a short maintenance
    reservation on the document, appends `discarded`, and releases it; a
    failed append keeps that reservation under the terminal-append rule.
    Restore is a controlled mutation whose `committed` record carries
    `resolves: <old transaction id>`; that single record is the old
    transaction's resolution, so no half-state can exist. In general every
    record is framed (length + checksum) and recovery discards an incomplete
    or corrupt final frame whole (WI-AL0.2).
  - **Controlled mutations** (MCP content tools, restore, hunk revert):
    (1) durably append `prepared` with the preimage hash and blob, taking the
    reservation; failure rejects the request with nothing changed. (2) After the prepare ack,
    re-verify synchronously — flush the editor, then check tab identity,
    preimage hash, document revision, IME composition state, for a hunk
    revert the hunk's `reviewGen`, and for `selection.set` the selection
    identity. If anything changed while
    prepare was in flight (user typed, closed the tab, started composing,
    moved the selection), append `aborted` and refuse with a retryable
    structured error; nothing is mutated. (3) Apply synchronously, with no
    `await` between re-verify and apply. (4) Capture the postimage in memory,
    then append `committed`.
  - **Commit failure in-session:** the response is
    `{applied: true, durable: false}`, never a plain error after content
    changed. The postimage sits in an in-memory degraded queue retried with
    backoff; while a document has an undrained entry, further *controlled*
    mutations on it are refused (`JOURNAL_DEGRADED`), and human edits (which
    cannot be refused) chain through an explicit `gap` record once the queue
    drains. Startup marks orphaned `prepared` records `uncommitted`; their
    preimage stays restorable. An `uncommitted` transaction ends with an
    explicit user action — restore its preimage (a new controlled mutation
    whose `committed` record carries `resolves: <old transaction id>`) or
    discard (appends `discarded`); only then is it unpinned (ADR-AL13).
    There is no standalone `resolved` record.
  - **Observational capture** (human edits, recorded at save): the edits
    already happened, so capture never blocks the disk save. Its journal
    append, however, is queued behind any reservation on that document, so a
    controlled transaction always finishes (commit or abort) first and the
    head stays linear. What waits is durable, not in memory: at save the
    writer immediately appends a `pendingObservation` (it does not advance
    the head and needs no reservation) carrying the actor, the postimage
    blob, and the exact predecessor of this edit: `observedParent` — either a
    revision id or the id of this window's own earlier, still-pending
    observation — with its blob as `observedPreimage`. Saves `H → B1 → B2`
    queued behind one reservation therefore keep their exact chain (B2's
    `observedPreimage` is B1). Restart replays unlinearized
    `pendingObservation` records in order. Linearization appends one revision
    per observation, in order, with `parent` = the head at that moment. When
    `observedParent` resolves to that head, it is an ordinary revision. When
    it does not (the same document edited in two windows with ownership off,
    or a controlled mutation landed first) it is a `concurrentObservation`
    carrying both `observedParent`/`observedPreimage` and the linear
    `parent`. Attribution and "what did this person change" always use
    `observedPreimage → postimage` (exact before-text); review, revert and
    export use `parent → postimage` (the linear history). Being a human
    save it has `reviewOp: none` and creates no hunk (ADR-AL8); instead the timeline marks it
    "edited in two windows" with a whole-document restore and a diff of
    both pairs, so nothing is silently merged. The save result reports `journaled: "yes" | "pending" | "no"`. A capture failure surfaces a visible "history not recorded"
    status and enters the same retry queue; the save result reports
    `journaled: "no"`.
- **ADR-AL7 — Document identity.** An immutable journal document UUID is
  minted at tab creation and carried through Save As and in-app rename. The
  path ↔ UUID map lives in the journal index (app data), not beside the
  file. On reopen, a path in the map gets its UUID back. An external rename
  is recognised by the watcher's rename event plus an unchanged file identity
  (inode / Windows file index) and moves the mapping; anything else (copy,
  new path, identity mismatch) gets a new UUID. Two paths with identical
  content are different documents.
- **ADR-AL8 — Review state is per hunk, not a cursor.** Hunk id = hash of
  (base revision id, target revision id, base range, target range, base text
  hash, target text hash). Each decision persists the hunk's geometry and
  text hashes with it, so it stays resolvable after the diff algorithm
  changes in a later release; the algorithm version is recorded as metadata,
  not as part of the id. A cursor may only summarize a fully reviewed prefix.
  Transitions:

  | From | Event | To |
  |---|---|---|
  | `pending` | user keeps | `kept` |
  | `pending` | revert applied | `reverted` |
  | `pending` | revert refused (overlap with later edits, or with another non-`settled` hunk's mapped span) | `conflicted` — decided by the worker before any prepare and written as one review-only record (below), so no `prepared`/`aborted` pair exists and no half-state can be crash-visible; a revert that passes this check and then fails re-verification ends `aborted` with the hunk unchanged |
  | `pending` / `conflicted` | a later `review`-op revision's change, mapped through every intervening revision, intersects the hunk's target span | `superseded` (the newer hunk is reviewed instead) |
  | `pending` / `conflicted` | a later `none`-op (human) revision overlaps the span | stays in its state, flagged "edited since" with the mapped span; it is still actionable (keep, or revert by three-way, which may yield `conflicted`) |
  | `pending` / `conflicted` | a human revision makes the hunk's mapped text equal its base text (the human undid it by hand; for a pure deletion, re-inserted exactly the deleted text at the anchor) | `resolvedByHumanEdit`, listed until "Clear reviewed" |
  | `pending` / `conflicted` | a `restore` revision's changed ranges intersect the hunk's mapped span | `superseded` by that restore's item |
  | `conflicted` | user marks it handled after editing by hand (review-only decision) | `resolvedByHumanEdit` |
  | `reverted` (not yet `settled`) | the revert revision is itself reverted | `pending` |
  | `kept` | the user un-keeps | `pending` |
  | `kept` / `reverted` / `superseded` / `resolvedByHumanEdit` | user runs "Clear reviewed" for the document | `settled` (terminal, irreversible) |

  `settled` is never reopened: reverting a revision whose hunks are settled
  (including a revert revision) produces new `pending` hunks of its own.

  Overlap effect of each `reviewOp` on *other* hunks. Only `pending` and
  `conflicted` hunks change state; decided states (`kept`, `reverted`,
  `superseded`, `resolvedByHumanEdit`) are never changed by a later
  revision — their spans keep being mapped, and un-keep or revert-of-revert
  goes through the three-way rule, which may yield `conflicted`. The worker
  computes every resulting transition and the writer appends them
  atomically in the same record as the revision. WI-AL2.3 has a
  table-driven test over every state × `reviewOp` pair:

  | Op | Effect on other `pending`/`conflicted` hunks whose mapped span intersects its changed ranges | Item count |
  |---|---|---|
  | `review` | `superseded` | + new hunks (admission-checked) |
  | `none` | "edited since", or `resolvedByHumanEdit` per the table above | unchanged |
  | `hunkRevert` | none — a revert whose range intersects another non-`settled` hunk is refused (`conflicted`), so it only ever touches its own hunk | unchanged |
  | `restore` | `superseded` by the restore item | + exactly 1 |

  Span mapping is eager: each new revision's mapped spans for every
  non-`settled` hunk are computed and persisted with the revision, so mapping
  never needs the intervening chain later (which GC may have collected).
  Execution boundary: all diffing and span mapping run in the frontend, in a
  dedicated Web Worker, against the head the writer reports; the append
  carries the mapped spans and the writer validates only that they cite the
  current head and matching text hashes (CAS retry on mismatch, bounded,
  then the degraded queue). Rust holds no diff library. A document holds at
  most 500 non-`settled` hunks from agent admission, enforced by
  backpressure rather than by deferring review.

  *Which revisions create hunks* is decided by a `reviewOp` recorded on
  each revision from its mutation kind, never inferred from the actor (the
  actor stays truthful). It is a closed tagged union, so every kind has
  exactly one behaviour:
  - `review` — agent and system content mutations: diffed into hunks.
  - `none` — plain human saves: recorded, shown in the timeline,
    restorable while retained under ADR-AL13, mapped through like any
    revision, but no hunks.
  - `hunkRevert { hunkId, expectedReviewGen }` — attaches this revision to
    the existing hunk (`reverted`; reverting that revert, itself a
    `hunkRevert` naming the same hunk, returns it to `pending`). It never
    creates an item and never meets backpressure. A hunk keeps at most one
    attached revert revision, its latest: exact revert-of-revert needs only
    the hunk's base, its target and that latest revision, so each new
    attachment releases the previous one to ordinary retention.
  - `restore { sourceRevision }` — creates exactly one coarse "restore"
    item. User restores are admitted past 500 up to a hard ceiling of 600;
    at 600 a restore is refused with `REVIEW_BACKLOG_FULL`
    (`retry: "afterUserReview"`) and the panel asks for "Clear reviewed".
    Restores are therefore conditionally admitted, never silently dropped.

  Review decisions are serialized with content: every hunk carries a
  `reviewGen` counter (unsigned 64-bit, 0 at creation, +1 per transition,
  never wrapped; the top two values are reserved: from `u64::MAX − 2` every
  user-initiated transition is refused with `REVIEW_STATE_EXHAUSTED` except
  those into a decided state (keep, "mark handled") and "Clear reviewed",
  so a `pending`/`conflicted` hunk can still be decided and then settled; a capture-driven transition (`superseded`,
  `resolvedByHumanEdit`) is never refused, and since it leads to a decided
  state that capture never changes again, at most one can occur and it
  uses at most `u64::MAX − 1`; settlement uses at most `u64::MAX`. So human
  capture is never blocked and the hunk can always be settled. The
  "edited since" flag is span metadata and does not bump `reviewGen`),
  and every review transition (keep, un-keep, revert,
  "Clear reviewed", `resolvedByHumanEdit`) is a journal record appended
  under the per-document reservation with a CAS on the hunk's `reviewGen`.
  A hunk revert records `expectedReviewGen` at prepare and re-verifies it
  in step (2) of ADR-AL6, so a Keep from another window is either refused
  immediately with `JOURNAL_BUSY` (the panel retries it, bounded; nothing
  ever blocks on the reservation) or, if it landed first, makes the revert
  abort with nothing mutated. A review-only decision (keep, un-keep,
  "Clear reviewed", "mark handled", a refused revert's `conflicted`)
  mutates no content, so
  it skips prepare/commit, but it is still re-verified against the editor:
  it carries the journal head and the tab's document revision the panel
  showed; on confirm the editor is flushed synchronously into the store
  (this does not journal anything — unsaved content reaches the journal
  only at save, per ADR-AL6), and if either value differs from the
  panel's snapshot, the decision is refused with `STALE_REVIEW` and the
  panel refreshes. The decision linearizes at that synchronous check: the
  check and the `invoke` are issued in one JS task, the writer's head CAS
  rejects it if any append landed in between, and an edit typed after
  the check is ordered after the decision and is mapped and captured
  normally (a settled hunk is unaffected by it). Otherwise the writer takes
  the reservation, appends one record, and releases the reservation on the
  append's ack or failure; it is never held across a UI
  await, and a failed append changes nothing and is reported to the panel.
  "Clear reviewed" is one atomic batch record over the set the user
  confirmed, carrying each hunk's expected `reviewGen`; if any is stale the
  whole batch is refused, the panel refreshes, and the user confirms again
  — never a partial settlement.

  Admission: a controlled agent/system mutation reserves one hunk slot at
  prepare, under the per-document reservation; with no free slot it is
  refused with `REVIEW_BACKLOG_FULL`, carrying `retry: "afterUserReview"`
  (not an immediate-retry error), and the panel asks the user to review or
  "Clear reviewed". After apply, the worker splits the change normally if
  the hunks fit in the free slots, otherwise the reserved slot holds one
  coarse whole-range hunk marked "large change" (distinct from ADR-AL15's
  "too complex to split"). Mapping cost per append is bounded by 600 spans,
  and every hunk is created at its own revision's append. No hunk is
  silently dropped, and position alone never resolves one: a `review` or
  `restore` change over its span supersedes it (the newer item is reviewed
  instead), while a human change resolves it only by text — the mapped
  text equals the hunk's base text. Deleting the surrounding text, or the
  span itself when the base was not empty, leaves the hunk actionable and
  flagged "edited since". A pure-deletion hunk is anchored at a position
  clamped to the document (offset 0 at the start, the end offset at the
  end, 0 in an empty document) with left affinity: text later inserted
  exactly at the anchor lands after it, so the anchor maps to the left of
  that text. The deletion hunk's mapped span is the contiguous text
  inserted at its anchor since the hunk was created, accumulated across
  revisions (start has left affinity, end has right affinity). A non-empty
  span flags the hunk "edited since"; the general equality rule alone
  decides resolution — the hunk is `resolvedByHumanEdit` when the span's
  text equals the deleted text, however many revisions built it. Revert
  inserts the deleted text at the span start, before any text inserted
  there since; a point insertion never conflicts with that text.
- **ADR-AL9 — Revert is a three-way operation, not a patch.** Inverse of the
  hunk is rebased from (base, hunk target, current) with exact matching — no
  fuzzy context. Disjoint later edits are preserved; any overlap refuses with
  `conflicted`; the current revision is checked; the revert is itself a
  journal revision and revertible. Whole-document restore stays separate.
- **ADR-AL10 — Normalization suppression is transport-only.** Only BOM and
  line-ending differences are hidden from review. Markdown-syntax or AST
  equivalence is never used to hide a change without a losslessness proof.
- **ADR-AL11 — Comment anchors resolve deterministically.** Precedence:
  exact quote + prefix/suffix context (32 UTF-16 units each) → quote within
  the stored heading path → quote anywhere. One candidate → `resolved`;
  several → `ambiguous`; none → `orphaned`. Anchors are created from the
  canonical Markdown (quote and context taken from it at selection time).
  Editor positions are ephemeral and surface-specific — ProseMirror
  positions are tree positions, Source mode uses character offsets — so an
  explicit WYSIWYG-selection → canonical-Markdown mapping is built (reusing
  the `selectionSurface.ts` split) and never assumed equal to a flat offset.
  Invariant: the stored quote and context are exact substrings of the
  canonical Markdown. Its feasibility is a Phase 0 spike (WI-AL0.9); if a
  selection cannot be mapped exactly, the comment widens to the enclosing
  block(s), and the UI says so.
  Stored offsets, when kept as hints, are UTF-16 code units into the
  canonical Markdown. States `open` →
  `addressed` (agent assertion) → `resolved` (user only) → `reopened`;
  `addressed` never implies `resolved`.
- **ADR-AL12 — Bounds.** Comment body ≤ 16 KiB, ≤ 1,000 comments per
  document, quote ≤ 4 KiB, `sessionLabel` ≤ 128 bytes, revision metadata
  arrays ≤ 64 entries. Exceeding a bound is a structured refusal, never a
  silent truncation.
- **ADR-AL13 — Retention and reachability-aware GC.** Defaults (settings,
  clamped): per document 500 revisions or 100 MB of blobs; global 2 GB; byte
  counts are UTF-8 bytes of stored blobs. Roots that are never collected:
  each document's latest revision; the base and target revisions of every
  hunk not yet `settled`, plus the single latest `hunkRevert` revision
  attached to such a hunk and its blobs (at most three revisions per hunk) (so un-keep and revert-of-revert stay possible
  after GC and restart);
  revisions referenced by an `open`/`addressed`/`reopened` comment;
  unresolved transactions only — transaction state is projected by
  transaction id, so `prepared → aborted` and `prepared → committed` pin
  nothing beyond their revisions, while `prepared` without a resolution and
  `uncommitted` not yet named by `committed { resolves }` or `discarded`
  stay pinned; degraded-queue
  entries and unlinearized `pendingObservation` records; the revision each
  live editor window last loaded for a document — whatever its next save
  will name as `observedParent`, a revision or a pending observation, with
  its blob —
  registered by the window and cleared on reload or close, or on save only
  after that save's `pendingObservation` is durably appended, with every
  such root dropped at startup because no window survives a restart; the
  revision mapped to each export branch head.
  GC runs inside the single writer under the journal lock, as a compaction
  (WI-AL0.2 protocol), oldest unpinned first. If everything over the cap is
  pinned, nothing pinned is deleted: the cap is exceeded and a visible
  warning names what pins it. Collected revisions leave a tombstone (id,
  parent, actor, timestamp, hashes). Export emits one commit per retained
  revision and one synthetic commit per maximal run of collected revisions;
  the synthetic commit's tree is the next retained revision's preimage, and
  its trailers list the collected id range and the set of actors
  (`VMark-Collected: <first>..<last>`, `VMark-Actors: …`).
- **ADR-AL14 — Legacy checkpoints are their own record type.** Existing
  checkpoints have only `contentBefore`, transient revision strings and
  `filePath`/`tabId`. They migrate to an immutable `legacyCheckpoint` record
  (preimage blob, nullable postimage, legacy anchor `filePath` or `tab:<id>`,
  tool, timestamp). They are excluded from parent-linked revision chains,
  hunk review and export. They stay visible in a global "Earlier
  checkpoints" list in the history panel (not filtered by the active tab),
  grouped by anchor. A `filePath` entry whose file is open or openable
  restores into that document as a normal controlled mutation; if the file
  is missing, moved, unreadable or unsupported, it restores into a new
  untitled document with a notice naming the original path and the reason.
  A `tab:<id>` entry (its tab gone after restart) restores only into a new
  untitled document, never over an existing one.
- **ADR-AL15 — Diff degradation.** Exact diffing has superlinear worst cases.
  Each diff runs under an operation budget (and a time budget as a backstop)
  that actually interrupts it: either the implementation is step-budgeted,
  or it runs in a Web Worker that is terminated at the deadline. When the
  budget is exceeded, the change is presented as one coarse whole-range hunk
  marked "too complex to split", which keep/revert still handle exactly.
  Growth is measured; linearity of the exact algorithm is not required. A
  diff library that cannot be interrupted either way is inadmissible
  (WI-AL0.4).

