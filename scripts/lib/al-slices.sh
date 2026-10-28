#!/usr/bin/env bash
#
# The agent-edit-ledger journal's vertical slices 1.1–1.7: one function per
# slice, each the slice gate's assertions. Sourced by scripts/check-al-slice.sh
# (one slice) and scripts/check-al-phase.sh (phase 1 runs all seven), after
# scripts/lib/dod-assertions.sh and scripts/lib/al-gate.sh.
#
# Each slice: its linked tests exist and pass (al_require_tests), the
# scenarios its slice gate names are covered by those tests (al_tests_cover),
# and the concrete code facts it promises hold. The gate does not read the
# plan; the scenario list below IS the slice's contract.

al_slice_1_1() {
  local wi=WI-AL1.1 s
  echo "Slice 1.1 — identity: connection, principal and session label reach dispatch"
  al_require_tests "$wi"
  for s in anonymous unrecognized ambiguous provider; do
    al_tests_cover "$wi" "$s" "$wi: principal state '$s' round-trips"
  done
  al_code_has 'McpWriteContext' src/services/mcpBridge "$wi: McpWriteContext defined in the bridge service"
  assert_ts_code_grep 'McpWriteContext' src/services/mcpBridge/v2/dispatch.ts "$wi: McpWriteContext threaded through dispatch"
  assert_grep_E 'session_label|sessionLabel' src-tauri/src/mcp_bridge/identify.rs "$wi: identify carries sessionLabel"
  assert_test_file src/services/mcpBridge/attribution.test.ts "$wi: Rust↔TS envelope parity test"
  assert_exec "$wi: envelope parity test passes" pnpm vitest run src/services/mcpBridge/attribution.test.ts
  assert_exec "$wi: cargo test mcp_bridge" al_cargo_test mcp_bridge::
}

al_slice_1_2() {
  local wi=WI-AL1.2
  echo "Slice 1.2 — Rust journal store: framing, generation, hydration, reservations, pins, migration"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'crash|torn|truncat'                 "$wi: crash-injection tests"
  al_tests_cover "$wi" 'hydrat'                             "$wi: hydration-gap test"
  al_tests_cover "$wi" 'STALE_PARENT|JOURNAL_BUSY|two.?window' "$wi: two-window prepare CAS test"
  al_tests_cover "$wi" 'pin'                                "$wi: pin-projection tests"
  al_tests_cover "$wi" 'migrat'                             "$wi: migration test on a fixture JSONL"
  al_code_has 'LegacyCheckpoint' src-tauri/src              "$wi: legacyCheckpoint record kind in the Rust journal"
}

al_slice_1_3() {
  local wi=WI-AL1.3
  echo "Slice 1.3 — document.write on the controlled-mutation protocol"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'abort'                       "$wi: aborted outcome"
  al_tests_cover "$wi" 'ime|composition'             "$wi: IME composition race"
  al_tests_cover "$wi" 'close'                       "$wi: tab-close race"
  al_tests_cover "$wi" 'selection'                   "$wi: selection-move race"
  al_tests_cover "$wi" 'STALE_PARENT|JOURNAL_BUSY|two.?window' "$wi: two-window prepare CAS"
  al_tests_cover "$wi" 'durable'                     "$wi: commit failure returns applied without durable"
  al_tests_cover "$wi" 'degraded'                    "$wi: degraded queue"
  al_tests_cover "$wi" 'reservation|retr(y|ies)'     "$wi: failed-aborted append recovers without restart"
}

al_slice_1_4() {
  local wi=WI-AL1.4
  echo "Slice 1.4 — transform, selection.set, apply_patch; observational capture of saves; editor collectors, certificates, budgets, deadline, IME"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'transform'                        "$wi: document.transform protocol"
  al_tests_cover "$wi" 'selection[._]?set'                "$wi: selection.set protocol"
  al_tests_cover "$wi" 'apply_?patch'                     "$wi: workflow.apply_patch protocol"
  al_tests_cover "$wi" 'concurrent_?observation'          "$wi: concurrentObservation dual bases"
  al_tests_cover "$wi" 'pending_?observation'             "$wi: crash between pendingObservation and linearization"
  al_tests_cover "$wi" 'observed_?parent'                 "$wi: observedParent GC root"
  al_tests_cover "$wi" 'observed_?preimage'               "$wi: observedPreimage GC root"
  al_tests_cover "$wi" 'journaled'                        "$wi: journaled flag on saves"
  al_tests_cover "$wi" 'capture.{0,40}fail|fail.{0,40}capture' "$wi: save-capture failure"
  # Production collectors, mounted — in CODE, so a commented-out call is no
  # mount; a gap in either fails closed, whole-document.
  assert_ts_code_grep 'createSourceProvenance' src/components/Editor/SourceEditor.tsx "$wi: Source collector mounted in SourceEditor"
  assert_ts_code_grep 'wysiwygProvenanceExtension' src/services/assembly/tiptapExtensions.ts "$wi: WYSIWYG observer in the editor's extensions"
  assert_ts_code_grep 'noteWysiwygFlush' src/components/Editor/useTiptapFlush.ts "$wi: WYSIWYG flush reports before its store write"
  assert_ts_code_grep 'noteWysiwygLoaded' src/components/Editor/tiptapContentLoad.ts "$wi: WYSIWYG content load anchors the collector"
  al_tests_cover "$wi" 'source:unobserved-transaction'  "$wi: Source collector gap breaks the whole document"
  al_tests_cover "$wi" 'wysiwyg:unobserved-transaction' "$wi: WYSIWYG collector gap breaks the whole document"
  # Certificates: only the session's own issue certifies a view.
  al_code_has 'class ViewCertificate' src/services/agentJournal "$wi: ViewCertificate defined in the journal service"
  al_tests_cover "$wi" 'openView'     "$wi: a view is certified by the certificate issued by openView"
  al_tests_cover "$wi" 'snapshotOnly' "$wi: an uncertified view is a snapshotOnly barrier"
  # Declared budgets on every retained collection; past one is a barrier.
  al_tests_cover "$wi" 'capOverflow'                    "$wi: a budget overflow is a capOverflow barrier"
  al_tests_cover "$wi" 'MAX_FROZEN_WINDOWS|maxFrozen'   "$wi: the frozen-window budget"
  al_tests_cover "$wi" 'MAX_WINDOW_STEPS'               "$wi: the WYSIWYG window step budget"
  al_test_has "$wi" '\.test\.rs$' "$wi: the journal's retention budget (Rust)" 'RetentionBudget|window_bases'
  # Every save-path journal call has a deadline.
  assert_ts_code_grep 'withJournalDeadline' src/services/agentJournal/saveJournal.ts "$wi: deadline on the save path's journal calls"
  al_tests_cover "$wi" 'withJournalDeadline|JOURNAL_DEADLINE_MS' "$wi: a hung journal fails loudly into the degraded path"
  # A closed tab's window base is released; a drained capture's base advances.
  al_code_has 'clear_window_base' src-tauri/src/agent_journal "$wi: the journal clears a released window's base"
  al_tests_cover "$wi" 'release_?window|releaseWindow' "$wi: a tab's journal base is released on close"
  al_tests_cover "$wi" 'drained'                       "$wi: a drained capture registers its window base"
  al_test_has "$wi" '^src/' "$wi: a WYSIWYG plugin set changed while live warns loudly and breaks the window" \
    '(^|[^a-z])registerPlugin' 'unregisterPlugin' 'journalWarn' 'wysiwyg:unobserved-transaction'
  al_test_has "$wi" '\.webkit\.test\.' "$wi: IME composition through both production collectors in real WebKit" \
    'compositionstart' 'createSourceProvenance' 'noteWysiwygFlush'
}

al_slice_1_5() {
  local wi=WI-AL1.5
  echo "Slice 1.5 — read tracking per connection; coherence capture uses the real actor"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'two.?clients?|second.?client|other.?client|client.?b([^a-z]|$)' "$wi: two-client read isolation test"
  assert_not_grep '"mcp-client"' src/services/coherence/mcpCapture.ts "$wi: coherence capture no longer hard-codes the \"mcp-client\" actor"
}

al_slice_1_6() {
  local wi=WI-AL1.6
  echo "Slice 1.6 — restore as a controlled mutation, uncommitted restore/discard, identity, GC collector"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'restore'    "$wi: restore records the overwritten buffer and is revertible"
  al_tests_cover "$wi" 'discard'    "$wi: uncommitted discard appends its terminal record"
  al_tests_cover "$wi" 'rename'     "$wi: identity survives an external rename"
  al_tests_cover "$wi" 'tombstone'  "$wi: collector writes tombstones"
  al_tests_cover "$wi" 'pin'        "$wi: collector never deletes a pinned record"
  # Restore is a controlled mutation: baseline first, revertible, a barrier
  # that never supersedes.
  al_test_has "$wi" '\.test\.rs$' "$wi: restore records the overwritten buffer first, is revertible and is a barrier that never supersedes" \
    'restore' 'baseline' 'revert' 'barrier' 'supersed'
  # Uncommitted entries are restored or discarded from the history panel.
  al_test_has "$wi" '^src/components/.*\.test\.tsx$' "$wi: the history panel's uncommitted restore and discard append their terminal records and drop the pin" \
    'uncommitted' 'restore' 'discard' 'resolves' 'pin'
  # Document identity (ADR-AL7).
  al_test_has "$wi" '\.test\.rs$' "$wi: identity lifecycle — external rename, untitled to Save As to rename to reopen keep one document; a copy is new" \
    'external.?rename' 'save.?as' 'reopen' 'cop(y|ied)'
  al_test_has "$wi" '\.test\.rs$' "$wi: a symlink and its target are one document" 'symlink' 'canonical|file.?id'
  al_test_has "$wi" '\.test\.rs$' "$wi: another spelling of an existing file is its document exactly when the volume says one entry; a missing name keeps its exact spelling" \
    'a_case_insensitive_volume_resolves_another_spelling_to_the_same_document' \
    'composed_and_decomposed_missing_names_keep_their_own_keys'

  al_test_has "$wi" '\.test\.rs$' "$wi: Windows separators and verbatim prefixes clean up to one text, with no case or Unicode folding" \
    'windows_separators_and_verbatim_prefixes_clean_up_to_one_text' \
    'a_windows_verbatim_unc_prefix_becomes_a_unc_path_never_a_relative_one' \
    'path_text_keeps_case_and_unicode_form_exactly'

  al_test_has "$wi" '\.test\.rs$' "$wi: on a case-insensitive Unix volume an ambiguous hard-link alias is refused; a provisional alias resolves through the stored spelling" \
    'a_case_alias_of_several_hard_links_is_refused_without_writing' \
    'a_provisional_alias_is_found_when_the_stored_spelling_comes_first'

  al_test_has "$wi" '\.test\.rs$' "$wi: stored spelling and exact missing names; hard links stay separate documents" \
    'an_existing_file_is_keyed_by_its_stored_spelling' \
    'missing_names_keep_their_exact_spelling' \
    'hard_links_keep_their_own_documents_and_a_case_alias_is_refused'
  # The collector (ADR-AL13), over the pin projection.
  al_code_has 'fn collect' src-tauri/src/agent_journal "$wi: the journal has a collector"
  al_test_has "$wi" '\.test\.rs$' "$wi: collector — a cap exceeded only by pinned records deletes nothing and warns" \
    'pins.?only|only.?pinned' 'warn'
  al_test_has "$wi" '\.test\.rs$' "$wi: collector writes tombstones for collected runs" 'tombstone' 'collect'
  al_test_has "$wi" '\.test\.rs$' "$wi: collector warns at 80% of the cap" 'near.?cap' 'warn'
  al_test_has "$wi" '\.test\.rs$' "$wi: collector keeps barriers, lastCertified revisions, capture bases and observed roots" \
    'barrier' 'last.?certified' 'capture.?base' 'observed.?parent' 'observed.?preimage'
  # The legacy checkpoint file retires only after a verified import.
  assert_rust_code_grep 'retire_legacy' src-tauri/src/agent_journal/service.rs "$wi: startup retires the verified legacy checkpoint file"
  al_test_has "$wi" '\.test\.rs$' "$wi: legacy retirement is idempotent and keeps an unverified original" \
    'retire' 'idempot' 'not.?verified|unverified'
}

al_slice_1_7() {
  local wi=WI-AL1.7
  echo "Slice 1.7 — history UI: attribution, degraded status, earlier checkpoints, i18n, docs"
  al_require_tests "$wi"
  al_tests_cover "$wi" 'anonymous|unrecognized|ambiguous' "$wi: the four principal states render distinctly"
  al_tests_cover "$wi" 'degraded|not recorded'           "$wi: degraded / history-not-recorded status"
  al_tests_cover "$wi" 'earlier.?checkpoints'            "$wi: global Earlier checkpoints list"
  al_tests_cover "$wi" 'untitled'                         "$wi: untitled entries restore into a new document"
  assert_grep_Ei 'session label' website/guide/mcp-setup.md "$wi: mcp-setup guide documents the session label"
  # The panel's component tests, one file per fact group (facts that must
  # hold together cannot be split across files and still pass).
  local panel='^src/components/.*\.test\.tsx$'
  al_test_has "$wi" "$panel" "$wi: who made each revision — provider, connection and session label; anonymous, unrecognized and ambiguous named as such" \
    'provider' 'connection' 'session' 'anonymous' 'unrecognized' 'ambiguous'
  al_test_has "$wi" "$panel" "$wi: both restore actions on a revision row" 'restore this version' 'before this change'
  al_test_has "$wi" "$panel" "$wi: blocked rows read reason (origin) under their lastCertified revision, or location unavailable" \
    'blocked' 'origin' 'last.?certified' 'unavailable'
  al_test_has "$wi" "$panel" "$wi: history-not-recorded status — degraded, read-only, refused save, deadline timeout, queued record" \
    'degraded' 'read.?only' 'refused' 'timeout' 'queued'
  al_test_has "$wi" "$panel" "$wi: earlier checkpoints — untitled entries restore into a new document, clear all" \
    'earlier.?checkpoints' 'untitled' 'new document' 'clear'
  al_test_has "$wi" "$panel" "$wi: live updates across windows from the journal generation broadcast" \
    'generation' 'two windows|converge'
  al_test_has "$wi" '\.test\.rs$' "$wi: history listing — newest first, truncated, blocked hunks at lastCertified, degraded, full actor" \
    'newest' 'truncat' 'blocked' 'last.?certified' 'degraded' 'actor'
  al_test_has "$wi" '\.test\.rs$' "$wi: generation broadcast — every append reaches it, bursts coalesce" \
    'generation' 'broadcast' 'coalesc'
  al_test_has "$wi" '^scripts/.*\.test\.mjs$' "$wi: the session label's guide claim is pinned to the code" \
    'VMARK_SESSION_LABEL' 'session label'
  local l
  for l in "" de/ es/ fr/ it/ ja/ ko/ pt-BR/ zh-CN/ zh-TW/; do
    assert_grep 'VMARK_SESSION_LABEL' "website/${l}guide/mcp-setup.md" "$wi: website/${l}guide/mcp-setup.md documents VMARK_SESSION_LABEL"
  done
  assert_exec "$wi: lint:i18n" pnpm lint:i18n
  assert_exec "$wi: lint:doc-joins" pnpm lint:doc-joins
}
