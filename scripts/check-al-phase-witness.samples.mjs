/**
 * Purpose: the witness self-test's fixture code — for every row of
 *   scripts/al-witnesses.json, one code line per assert regex, in assert
 *   order. A row's lines together satisfy every regex, and without line k
 *   regex k fails, so a fixture written without line k is that row with one
 *   assertion missing (the self-test checks both facts before it uses them).
 *
 * TypeScript lines run inside an `async` case body; Rust lines inside a
 * `#[test] fn`; e2e lines inside a journey's `async run(client, ctx)`.
 * Strings are the text written to the fixture file verbatim.
 *
 * @coordinates-with scripts/check-al-phase-witness.test.mjs — builds the fixture trees from these lines
 * @coordinates-with scripts/al-witnesses.json — the rows and regexes these lines answer
 * @module scripts/check-al-phase-witness.samples
 */

const OPEN = "let w = Writer::open(cfg.clone()).unwrap();";

export const SAMPLES = {
  // Phase 2
  "keep B of {A, B}, restart → only A pending": [OPEN, "assert_eq!(state(&w, a), HunkState::Pending);", "assert_eq!(state(&w, b), HunkState::Kept);"],
  "revert preserves a later disjoint human edit": [
    "w.revert_hunk(doc, agent).unwrap();", 'assert!(after.contains("human line"));', String.raw`assert_eq!(after, "intro\nhuman line\nend\n");`,
  ],
  "revert of a revert restores exactly, across a restart": [
    OPEN, "let r = w.revert_hunk(doc, h).unwrap(); w.revert_hunk(doc, r).unwrap();", String.raw`assert_eq!(text(&w, doc), "original\n");`,
  ],
  "overlap → conflicted, with a message": [
    'expect(row.dataset.state).toBe("conflicted");', 'expect(screen.getByText(t("review.hunkConflicted"))).toBeInTheDocument();',
  ],
  "CRLF- or BOM-only save shows no hunks; a real whitespace edit shows": [
    String.raw`const crlf = "a\r\nb\r\n";`, String.raw`const bom = "\uFEFFtext";`, "expect(hunks(crlf, bom)).toHaveLength(0);",
    'expect(hunks("a b", "a  b").length).toBeGreaterThanOrEqual(1);',
  ],
  "WI-AL0.6 budgets met, measured on the CPU clock": ["const ms = cpuMs(() => diff(big));", "expect(ms).toBeLessThan(200);"],
  "600 review rows paint and scroll to the last row within 100 ms": [
    "const rows = renderRows(600);", "list.scrollTop = list.scrollHeight;",
    "expect(paintMs).toBeLessThan(100); expect(scrollMs).toBeLessThan(100);", "await expect.element(last).toBeVisible();",
  ],
  "aZ/Za: the rotating hunk is refused, the disjoint one reverts exactly": [
    'let pre = "aZ";', 'let post = "Za";', "assert!(matches!(err, RevertError::AmbiguousRevert));", "assert_eq!(text(&w, doc), EXPECTED);",
  ],
  "a remount without a certificate refuses, journal and projection unchanged": [
    OPEN, "assert!(matches!(w.apply_uncertified(doc), Err(AmbiguousRevert)));", "assert_eq!(w.projection(), proj_before);",
    "assert_eq!(journal_len(&w), len_before);",
  ],
  "R24 oracle: zero wrong, zero span mismatches, nonzero successes, refusals change nothing": [
    "expect(tally.wrongReverts).toBe(0);", "expect(tally.spanMismatches).toBe(0);", "expect(tally.successes).toBeGreaterThan(0);",
    "expect(snapshot(state)).toEqual(before);",
  ],
  "WYSIWYG net-zero capture, end to end through the production sessions": [
    "stop = startProvenanceSessions();", 'deleteAndRetype(editor, "a");', "expect(prepareInput(1)).toMatchObject({ baselineTouched: true });",
    "expect(distant.baseline).not.toBeNull();", 'expect(mapHunk(map, T1, "a").block).toEqual({ reason: "uncertifiedRange" });',
    'expect(mapHunk(map, T1, "far end").block).toBeNull();',
  ],
  "WYSIWYG net-zero capture, in the production collector": [
    'deleteAndRetype(editor, "a");', "expect(touched).toBe(true);", 'expect(mapHunk(p, T1, "a").block).toEqual({ reason: "uncertifiedRange" });',
    'expect(mapHunk(p, T1, "ara tw").block).toBeNull();',
  ],
  "WYSIWYG widening shown: the production collector's blocked hunk carries the panel indicator": [
    "const stop = startProvenanceSessions();", 'const badge = screen.getByLabelText(t("review.hunkBlocked"));', "expect(badge).toBeInTheDocument();",
  ],
  "admission outcome: a write error refuses, journal and projection unchanged": [
    "assert_eq!(outcome, Admission::Refused);", "assert_eq!(w.projection(), proj_before);", "assert_eq!(journal_len(&w), len_before);",
    "faults.fail_next_write();",
  ],
  "admission outcome: an fsync failure is indeterminate, poisons, and reopens cleanly": [
    "faults.fail_next_fsync();", "assert!(outcome.indeterminate);", "assert!(w.is_poisoned());", OPEN,
  ],
  "admission outcome: success prepares and the live projection equals the replayed one": [
    "assert_eq!(outcome, Admission::Prepared);", "assert_eq!(w.projection(), replayed.projection());", OPEN,
  ],
  "prepare failure leaves the content unchanged": [
    'journal.prepare.mockRejectedValueOnce(new Error("disk"));', "expect(store.content).toBe(before);", 'expect(out.status).toBe("refused");',
  ],
  "commit failure answers applied but not durable, and blocks the next mutation": [
    'journal.commit.mockRejectedValueOnce(new Error("disk"));', "expect(out).toMatchObject({ applied: true, durable: false });",
    'expect(next.status).toBe("refused");',
  ],
  "trust boundary: no MCP operation schema admits provenance keys": [
    'forbid("provenance");', 'forbid("certificate");', 'forbid("capture");', 'forbid("hunks");', 'forbid("spans");', "expect(admitted).toEqual([]);",
  ],
  "trust boundary: the bridge refuses a request carrying a provenance key": [
    "const req = { provenance: { spans: [] } };", "expect(res.isError).toBe(true);", 'expect(res.message).toContain("provenance");',
  ],
  "trust boundary: a capture seq regression is refused": [
    "let older = Capture { seq: 3, ..last };", "assert!(w.capture(older).is_err());", "assert_eq!(journal_len(&w), len_before);",
  ],
  "staged blob visibility: the baseline derives with its preimage absent from the pack": [
    "let baseline = derive_staged(&w, doc);", "assert!(!pack_contains(&w, preimage_id));", "assert_eq!(pack_len(&w), 0);",
  ],
  "admission-owned state: a refused admission leaves reservations, degraded queues and window bases unchanged": [
    "assert_eq!(outcome, Admission::Refused);", "assert_eq!(w.reservations(), reservations_before);",
    "assert_eq!(w.degraded_queue(doc), queue_before);", "assert_eq!(w.window_base(doc), base_before);", "assert_eq!(journal_len(&w), len_before);",
  ],
  "live = replay: Projection equality, requests included, after an immediate retry": [
    "let a = w.prepare(req.clone()); let b = w.prepare(req);", "let replayed = Writer::open(cfg.clone()).unwrap();",
    "assert_eq!(w.projection(), replayed.projection());", "assert!(replayed.projection().requests.contains_key(&req_id));",
  ],
  "compaction of admissions: surviving seq unchanged, receipt retained, reopen clean": [
    "w.compact().unwrap();", "assert_eq!(survivor.seq, seq_before);", "assert!(w.receipt(req_id).is_some());", OPEN,
  ],
  "duplicate states: executable, terminalPending, terminal and unavailable, with zero extra apply": [
    "assert!(matches!(a, Duplicate::Executable));", "assert!(matches!(b, Duplicate::TerminalPending));", "assert!(matches!(c, Duplicate::Terminal));",
    "assert!(matches!(d, Duplicate::Unavailable));", "assert_eq!(applies.get(), 1);",
  ],
  "page load revokes the owner: its commit is STALE_PAGE and the worker records uncommitted": [
    "l.started(&a.label);", 'assert_eq!(journal_code(&e), "STALE_PAGE");', "l.run_held();", "assert_eq!(l.r.status(txn), Some(TxnStatus::Uncommitted));",
  ],
  "destroy between begin and admission: staleGeneration, nothing reserved": [
    "let (held, go) = hold_original(&l.r, &a, &p);", "l.destroyed(&a.label);", "assert_eq!((inflight, owners, receipts, reservations), (0, 0, 0, 0));",
  ],
  "page entries change the table before they signal the cleanup worker": [
    "let l = life_inline();", "l.started(&a.label);", "l.replace(&a, 3);", "l.destroyed(&b.label);", "assert_eq!(l.ended()[2..], [(t3, OwnedEnd::Recorded)]);",
  ],
  "page entries return while the writer lock is held": [
    "let g = l.r.c.writer.lock();", "returns_at_once(move || other.started(&label));", "assert_eq!(l.r.pages.labels(), 0);",
  ],
  "cleanup worker: an event before the exit decision is served by the running worker": [
    "let (reached, go) = pause_once(&w, Point::AfterPass);", "assert_eq!(spawns.load(SeqCst), 1);",
  ],
  "cleanup worker: concurrent producers never run two passes, and a pass follows the last event": [
    "assert_eq!(g.max.load(SeqCst), 1);", "assert_eq!(seen.load(SeqCst), 40_000);",
  ],
  "cleanup worker: a panicking pass leaves the work pending and counted, and the next event restarts it": [
    "assert_eq!(w.state(), (true, false));", "assert_eq!((g.passes.load(SeqCst), spawns.load(SeqCst)), (1, 2));",
  ],
  "cleanup worker: a refused spawn rolls back the claim": [
    "assert_eq!(w.state(), (true, false));", "assert_eq!((w.failures(), g.passes.load(SeqCst)), (1, 0));",
  ],
  "owner death: a queued commit is left as it is and survives": [
    'l.r.commit(&a, txn, "text!").unwrap();', "assert_eq!(l.ended(), vec![(txn, OwnedEnd::AlreadyQueued)]);", "assert_eq!(queue(&l), queued);",
  ],
  "owner death: a cleanup append failing once is released by the drainer alone": [
    "l.r.faults.fail_next_appends(1);", "assert_eq!(l.ended(), vec![(txn, OwnedEnd::Queued)]);", "released(&l, txn);",
  ],
  "owner death: destroying one window ends only its transactions": [
    "l.destroyed(&a.label);", "assert_eq!(l.ended(), vec![(ta, OwnedEnd::Recorded)]);", "assert_eq!(l.r.status(tb), Some(TxnStatus::Prepared));",
  ],
  "owner death: discarded and resolved are already terminal, with nothing appended": [
    "assert!(matches!(l.r.status(txn), Some(TxnStatus::Discarded { .. })));", "assert_eq!(l.r.status(txn), Some(TxnStatus::Resolved { by }));",
    "swept_as_already_terminal(&l, txn);",
  ],
  "abandon racing a queued commit keeps the earlier intent, in both orders": [
    'r.commit(&a, txn, "text!").unwrap();', "let later = r.abandon(&a.label, &p);", 'one_intent(&r, txn, "Committed", TxnStatus::Committed);',
  ],
  "abandon racing a queued abort keeps the earlier intent, in both orders": [
    "r.abort(&a, txn).unwrap();", "let later = r.abandon(&a.label, &p);", 'one_intent(&r, txn, "edited", TxnStatus::Aborted);',
  ],
  "the journal status reports cleanup worker failures": [
    'assert_eq!(json["cleanupWorkerFailures"], json!(0));', "assert_eq!(state.status().cleanup_worker_failures, 1);",
  ],
  "a capture reply delivered into another page's callback cannot mark a save recorded": [
    "harness.reload();", "harness.deliver(old.callback, misbound);", "const out = captureSaveToJournal(input);",
    'await expect(out).rejects.toMatchObject({ journalCode: "JOURNAL_UNAVAILABLE" });',
  ],
  "every agent_journal command in all_commands! has an R98 bind or a callId echo": [
    'let registry = include_str!("../command_registry.rs");', 'assert!(returns.contains("Bound<CallBind"));',
    'assert!(sig.contains("call_id: String"));', "assert_eq!(call_bound, CALL_BOUND.to_vec());",
  ],
  "uncertainty contract: the freeze is released only on a confirmed clean refusal": [
    "expect(release).toHaveBeenCalled();", "expect(releaseOnRetry).not.toHaveBeenCalled();", "expect(invalidate).toHaveBeenCalled();",
    "expect(out).toMatchObject({ uncertain: true });",
  ],
  "identity on the wire: every live journal command refuses a request missing an identity field": [
    'let err = invoke_from(&page.win, command, args).unwrap_err();', 'assert_eq!(err["detail"]["journalCode"], "INVALID_REQUEST");',
    'assert!(text.contains("missing required key pageIdentity"));', "assert_eq!(a.journal_len(), before);",
  ],
  "Tauri's IPC fallback re-executes a command whose response body failed, with its payload byte for byte": [
    'expect([first.via, second.via]).toEqual(["customProtocol", "postMessage"]);', "expect(effects).toBe(2);", "expect(second.body).toBe(first.body);",
  ],
  "a reloaded page's old prepare and commit replies cannot confirm the successor's write": [
    "harness.reload();", "harness.deliver(ids[1], reply);", 'expect(content()).toBe("before");', "expect(await out).toMatchObject({ refusal: { uncertain: true } });",
  ],
  "uncertainty contract: every Rust refusal code has its TypeScript journal code": [
    'const rust = readFileSync("src-tauri/src/agent_journal/refusal.rs", "utf8");', "const codes = JOURNAL_CODES;",
    'expect(codes).toContain("AMBIGUOUS_REVERT");',
  ],
  "writer-bound certificate: a dirty-buffer write is certified and reverts an unaffected hunk exactly": [
    "let dirty = edit_buffer(&w, doc);", "assert!(write.certified);", "w.revert_hunk(doc, other).unwrap();",
    String.raw`assert_eq!(text(&w, doc), "intro\nkept\n");`,
  ],
  "stale page: a commit refused STALE_PAGE is applied, not durable, never retried, and the registration renews with replaces = the old pair": [
    "wire.on(COMMIT, stalePage);", 'expect(out).toMatchObject({ status: "applied", durable: false });', "expect(wire.argsOf(COMMIT)).toHaveLength(1);",
    "expect(fresh.replaces).toEqual(old);",
  ],
  "stale page: an abort refused STALE_PAGE ends the request and the registration renews": [
    "wire.on(ABORT, stalePage);", 'expect(out).toMatchObject({ status: "aborted" });', "expect(wire.argsOf(COMMIT)).toEqual([]);",
    "expect(fresh.replaces).toEqual(old);",
  ],
  "sealed and revoked staleGeneration answers recover identically: drain, then one fresh registration naming the old pair": [
    'const sealed = await recover("sealed");', 'const revoked = await recover("revoked");', 'const answer = { state: "staleGeneration" };',
    "expect(r.registeredBeforeDrain).toBe(1);", "expect(r.slots).toBe(1);",
  ],
  "a pagehide while committing leaves the commit and its outcome unchanged": [
    "pagehide(true);", 'expect(await out).toMatchObject({ status: "applied", durable: true });', "expect(wire.argsOf(ABANDON)).toEqual([]);",
  ],
  "a registration that never answers ends JOURNAL_TIMEOUT with zero prepares and no timer left": [
    'expect(await out).toMatchObject({ refusal: { journalCode: "JOURNAL_TIMEOUT" } });', "expect(wire.payloadsOf(PREPARE)).toEqual([]);",
    "expect(vi.getTimerCount()).toBe(0);",
  ],
  "a budget spent after the dispatch ends JOURNAL_TIMEOUT, uncertain, and abandons the original payload": [
    'expect(out).toMatchObject({ refusal: { journalCode: "JOURNAL_TIMEOUT", uncertain: true } });', "expect(abandons()).toEqual(prepares());",
  ],
  // e2e journeys: these lines run inside the journey's `run(client, ctx)`.
  "native: a reload during a held prepare leaves the held txn uncommitted, and the new page's first write succeeds": [
    'await evalJs(client, `holdCommand("agent_journal_commit")`);', 'await evalJs(client, "location.reload()");',
    'const after = await journalOf(client, filePath);', 'if (after.uncommitted.length !== 1) throw new Error("not one uncommitted");',
    'if (!written.durable) throw new Error("not recorded");',
  ],
  "native: a hash change and a pushState keep the page's registration live": [
    'await evalJs(client, `location.hash = "#j"`);', 'await evalJs(client, `history.pushState({}, "", "/j")`);',
    'const registers = await countCalls(client, "agent_journal_register_page");', 'if (!written.durable) throw new Error("not recorded");',
  ],
  "native: an iframe load keeps the page's registration live": [
    'await evalJs(client, `document.body.append(document.createElement("iframe"))`);',
    'const registers = await countCalls(client, "agent_journal_register_page");', 'if (!written.durable) throw new Error("not recorded");',
  ],
  "native: five rapid reloads, each followed by an agent write that succeeds": [
    'await evalJs(client, "location.reload()");', "const RELOADS = 5;", 'if (!written.durable) throw new Error("not recorded");',
  ],
  // Phase 3
  "duplicated passage → ambiguous": ["let r = resolve(&doc, &anchor);", "assert_eq!(r, Resolution::Ambiguous);"],
  "deleted passage → orphaned": ["let r = resolve(&doc, &anchor);", "assert_eq!(r, Resolution::Orphaned);"],
  "heading rename still resolves by context": [
    String.raw`let doc = "## Renamed\nbody";`, "let r = resolve(&doc, &anchor);", "assert!(matches!(r, Resolution::Exact(_)));",
  ],
  "selection across headings maps exactly or widens visibly": [
    String.raw`let doc = "# One\na\n## Two\nb";`, "let r = resolve(&doc, &anchor);", "assert!(matches!(r, Resolution::Exact(_) | Resolution::Widened(_)));",
  ],
  "CJK, emoji and RTL offsets equal the expected UTF-16 numbers": [
    'let cjk = "中文";', 'let emoji = "😀";', 'let rtl = "שלום";', "assert_eq!(offset(&doc, 5), 12);",
  ],
  "anchor quote bound: 4096 bytes accepted, 4097 refused": [
    "let fits = quote(4096);", "let too_long = quote(4097);", "assert_eq!(err.code, COMMENT_ANCHOR_TOO_LONG);",
  ],
  "reply body bound: 16,384 bytes accepted, 16,385 refused": [
    "let fits = body(16384);", "let big = body(16385);", "assert!(add_reply(&w, big).is_err());",
  ],
  "replies per comment: 200 accepted, 201 refused": [
    "for _ in 0..200 { add_reply(&w).unwrap(); }", "let next = 201;", "assert!(add_reply(&w).is_err());",
  ],
  "comments: 1,000 accepted, 1,001 refused": ["fill_comments(&w, 1000);", "let next = 1_001;", "assert!(add_comment(&w).is_err());"],
  "logical byte limits at the boundary: thread 256 KiB, document 4 MiB, global 64 MiB": [
    "fill_thread(&w, 256 * 1024);", "fill_document(&w, 4 * 1024 * 1024);", "fill_global(&w, 64 * 1024 * 1024);",
    "assert!(add_comment(&w).is_err());", "assert!(resolve_thread(&w).is_ok());",
  ],
  "physical cap: 128 MiB of retained records refuses with COMMENT_STORAGE_FULL": [
    "fill_physical(&w, 128 * 1024 * 1024);", "assert_eq!(err.code, COMMENT_STORAGE_FULL);",
  ],
  "terminal reserve: resolve and delete succeed with the budget full": [
    "fill_logical(&w);", "let r = resolve_comment(&w, id);", "let d = delete_comment(&w, id);", "assert!(r.is_ok() && d.is_ok());",
  ],
  "a comment id is never reused after delete and restart": [
    "delete_comment(&w, id).unwrap();", OPEN, "assert_ne!(add_comment(&w).unwrap(), id);",
  ],
  "agent resolve refused, with nothing appended": [
    'const res = await call("resolve", { id });', "expect(res.isError).toBe(true);", "expect(append).not.toHaveBeenCalled();",
  ],
  "comment HTML renders as text only": [
    'const body = "<script>alert(1)</script>";', 'expect(view.querySelector("script")).toBeNull();', "expect(view.textContent).toBe(body);",
  ],
  "every WI-AL0.9 fixture maps exactly or widens visibly, through the production resolver": [
    'let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures/anchor.json")).unwrap();',
    "if outcome == Outcome::Exact { exact += 1; }", "if outcome == Outcome::Widened { widened += 1; }", "assert!(fixtures.len() >= 47);",
  ],
  "heading goldens come from the production parser, with no drift": [
    "const tree = parseMarkdownToMdast(src);", 'const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));', "expect(generate(tree)).toEqual(golden);",
  ],
  "a future record stops before repair, the file's bytes unchanged": [
    "assert_eq!(err.code(), FUTURE_FORMAT);", "let digest = Sha256::digest(&bytes);", "assert_eq!(hashes(&dir), before);",
    "append_raw(&path, &torn_frame(10));", "let r = Writer::open_with_max_schema(cfg.clone(), 3);",
  ],
};
