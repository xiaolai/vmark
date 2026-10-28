// WI-AL3.1b — R45 physical cap at full size: with compaction off, 1,000 create → resolve → delete cycles of near-limit threads stop at 128 MiB of physical bytes with COMMENT_STORAGE_FULL, every later create is refused without appending, projected (logical) usage never passes one thread, and the replay of the full journal is timed
//! The real `PHYSICAL_BYTES` (128 MiB) drives the run; no cap is scaled.

use std::time::Instant;

use crate::agent_journal::comment::bounds::{MAX_BODY_BYTES, MIB, PHYSICAL_BYTES, THREAD_BYTES};
use crate::agent_journal::comment::comment_support::*;
use crate::agent_journal::comment::ids::CommentId;
use crate::agent_journal::writer::Writer;

/// Replies of a near-limit thread: each record carries a body near the
/// 16 KiB cap (about 17 KB framed), so the create and 14 replies stay
/// under the 256 KiB thread cap and a 15th reply would not.
const REPLIES: u64 = 14;
const CYCLES: u64 = 1_000;

#[test]
fn the_physical_cap_is_128_mib() {
    assert_eq!(PHYSICAL_BYTES, 128 * 1024 * 1024);
}

/// The `(logical, physical)` totals of the live book.
fn totals(r: &crate::agent_journal::admission::request_support::Rig) -> (u64, u64) {
    let g = r.c.writer.lock();
    (g.proj.comments.logical, g.proj.comments.physical)
}

#[test]
fn a_thousand_near_limit_cycles_stop_at_the_physical_cap() {
    let (r, page) = rig();
    let body = "x".repeat(usize::try_from(MAX_BODY_BYTES - 64).expect("body"));
    let u = r.c.comments_user();
    let (mut full_at, mut max_logical, mut refused) = (None, 0, 0u64);
    let started = Instant::now();
    for cycle in 0..CYCLES {
        let len = r.journal_len();
        let c: CommentId = match create(&r, &page, &body) {
            Ok(reply) => comment_of(&reply),
            Err(e) => {
                assert_eq!(code(&e), "COMMENT_STORAGE_FULL", "cycle {cycle}: {e:?}");
                assert_eq!(r.journal_len(), len, "a refusal appends nothing");
                full_at.get_or_insert(cycle);
                refused += 1;
                continue;
            }
        };
        let mut comment_gen = 0;
        for _ in 0..REPLIES {
            let len = r.journal_len();
            match reply(&r, &page, c, comment_gen, &body) {
                Ok(_) => comment_gen += 1,
                Err(e) => {
                    assert_eq!(code(&e), "COMMENT_STORAGE_FULL", "cycle {cycle}: {e:?}");
                    assert_eq!(r.journal_len(), len, "a refusal appends nothing");
                    full_at.get_or_insert(cycle);
                    break;
                }
            }
        }
        if full_at.is_none() {
            assert!(
                thread(&r, c).logical() > THREAD_BYTES - 2 * MAX_BODY_BYTES,
                "a near-limit thread"
            );
        }
        max_logical = max_logical.max(totals(&r).0);
        // Terminal actions spend the reserve counted at creation, so a
        // thread ends even when storage is full.
        u.resolve(&state_req(c, comment_gen)).expect("resolve");
        u.delete(&state_req(c, comment_gen + 1)).expect("delete");
        let (logical, physical) = totals(&r);
        assert_eq!(logical, 0, "a deleted thread leaves the logical budget");
        assert!(physical <= PHYSICAL_BYTES, "cycle {cycle}: {physical}");
    }
    let written = started.elapsed();
    let (logical, physical) = totals(&r);
    let full_at = full_at.expect("the cap is reached within 1,000 cycles");
    assert!(refused > 0 && refused < CYCLES - full_at + 1, "{refused}");
    assert!(
        physical > PHYSICAL_BYTES - THREAD_BYTES,
        "stopped at the cap, not short of it: {physical}"
    );
    assert!(max_logical <= THREAD_BYTES, "projected usage stays low");
    assert_eq!(logical, 0);

    let book = r.c.writer.lock().proj.comments.clone();
    let (dir, _) = close(r);
    let started = Instant::now();
    let (w, _) = Writer::open(fast_config(dir.path())).expect("replay");
    let replayed = started.elapsed();
    assert_eq!(w.lock().proj.comments, book, "replay equals the live book");
    eprintln!(
        "R45 physical cap: full at cycle {full_at}, {} MiB physical, {refused} creates refused; \
         writing took {written:?}, replay took {replayed:?}",
        physical / MIB
    );
}
