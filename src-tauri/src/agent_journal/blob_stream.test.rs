// WI-AL1.2 — the blob pack index is built by streaming, torn pack tails truncated, compaction keeps the pinned set in bounded memory
//! R13 — the blob pack index is built by streaming: open reads frame
//! headers and hashes payloads chunk by chunk without retaining them, and
//! blobs are read on demand by offset. The streamed scan classifies every
//! file exactly as the in-memory scan does (torn tail vs corrupt), and the
//! index stays correct across a compaction rebuild and later appends.
//!
//! Edge cases: empty pack, truncation at every byte of the last frame, a
//! zero-filled tail, checksum damage at the end vs in the middle, a blob
//! whose content does not match its hash, empty and CJK/emoji blobs, and
//! peak memory while opening a pack far larger than the cap.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::collections::BTreeSet;
use std::io::Cursor;
use std::sync::Arc;

use crate::agent_journal::blob_store::{BlobStore, BLOB_PACK};
use crate::agent_journal::faults::Faults;
use crate::agent_journal::frame::{encode, scan, scan_stream, FrameSink};
use crate::agent_journal::ids::BlobHash;
use crate::agent_journal::journal_file::SyncPolicy;

struct Counting;

// Per-THREAD counters. A process-wide count also billed whatever the other
// test threads allocated meanwhile (the whole lib suite runs in parallel), so
// the peak measured while opening a pack could exceed the bound for reasons
// unrelated to the pack. `BlobStore::open` runs on the calling thread, so the
// calling thread's own bytes are exactly the open's. Signed: a block freed
// here may have been allocated on another thread. Const-initialised `Cell`s
// have no destructor and never allocate, so the allocator may touch them.
thread_local! {
    static CURRENT: Cell<isize> = const { Cell::new(0) };
    static PEAK: Cell<isize> = const { Cell::new(0) };
}

fn bill(delta: isize) {
    let _ = CURRENT.try_with(|c| {
        let now = c.get() + delta;
        c.set(now);
        let _ = PEAK.try_with(|p| p.set(p.get().max(now)));
    });
}

// SAFETY: every call forwards to `System` with the caller's layout unchanged;
// the counters are side bookkeeping and never affect the returned memory.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        bill(l.size() as isize);
        // SAFETY: the caller upholds `alloc`'s contract for `l`; forwarded as is.
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        bill(-(l.size() as isize));
        // SAFETY: `p` came from `System.alloc(l)` above with this same layout.
        unsafe { System.dealloc(p, l) }
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

/// Tests in this file take turns, so one measurement never shares the
/// machine with another of this file's large packs.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn store(dir: &std::path::Path) -> BlobStore {
    BlobStore::open(dir, SyncPolicy::None, Arc::new(Faults::default())).expect("open pack")
}

/// Records what the streamed scan reports, to compare with `scan`.
#[derive(Default)]
struct Collect {
    cur: Vec<u8>,
    frames: Vec<(u64, Vec<u8>)>,
}

impl FrameSink for Collect {
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.cur.extend_from_slice(bytes);
        Ok(())
    }
    fn frame(&mut self, payload_offset: u64, _len: u64) -> Result<(), String> {
        self.frames
            .push((payload_offset, std::mem::take(&mut self.cur)));
        Ok(())
    }
    fn discard(&mut self) {
        self.cur.clear();
    }
}

fn same_as_in_memory(bytes: &[u8]) {
    let want = scan(bytes);
    let mut sink = Collect::default();
    let got = scan_stream(&mut Cursor::new(bytes), bytes.len() as u64, &mut sink);
    match (want, got) {
        (Ok(w), Ok(g)) => {
            assert_eq!((g.valid_len, g.tail), (w.valid_len, w.tail));
            let wf: Vec<_> = w
                .frames
                .into_iter()
                .map(|f| (f.payload_offset, f.payload))
                .collect();
            assert_eq!(sink.frames, wf);
        }
        (Err(_), Err(_)) => {}
        (w, g) => panic!("in-memory {w:?} vs streamed {g:?}"),
    }
}

#[test]
fn the_streamed_scan_classifies_every_file_like_the_in_memory_scan() {
    let _turn = serial();
    same_as_in_memory(&[]);
    let frames: Vec<u8> = [b"a".as_slice(), b"", "中文🙂".as_bytes(), &[7u8; 70_000]]
        .iter()
        .flat_map(|p| encode(p))
        .collect();
    same_as_in_memory(&frames);
    let last = frames.len() - encode(&[7u8; 70_000]).len();
    for cut in
        (last..frames.len())
            .step_by(997)
            .chain([last + 1, last + 15, last + 16, frames.len() - 1])
    {
        same_as_in_memory(&frames[..cut]);
    }
    let mut zero_tail = frames.clone();
    zero_tail.extend_from_slice(&[0u8; 4096]);
    same_as_in_memory(&zero_tail);
    let mut end_damage = frames.clone();
    *end_damage.last_mut().unwrap() ^= 1;
    same_as_in_memory(&end_damage);
    let mut mid_damage = frames.clone();
    mid_damage[HEADER] ^= 1;
    same_as_in_memory(&mid_damage);
    let mut bad_magic = frames.clone();
    bad_magic[encode(b"a").len()] = b'X';
    same_as_in_memory(&bad_magic);
}

const HEADER: usize = crate::agent_journal::frame::HEADER_LEN;

#[test]
fn the_index_survives_compaction_and_later_appends() {
    let _turn = serial();
    let dir = tempfile::tempdir().unwrap();
    let texts = ["", "a", "中文🙂", "b", "c"];
    let mut s = store(dir.path());
    for t in texts {
        s.put(&BlobHash::of_text(t), t).unwrap();
    }
    let keep: BTreeSet<_> = ["", "中文🙂", "c"]
        .iter()
        .map(|t| BlobHash::of_text(t))
        .collect();
    s.compact(&keep).unwrap();
    for t in ["", "中文🙂", "c"] {
        assert_eq!(
            s.get(&BlobHash::of_text(t)).unwrap(),
            t,
            "{t:?} after compaction"
        );
    }
    assert!(!s.contains(&BlobHash::of_text("a")) && s.get(&BlobHash::of_text("b")).is_err());
    s.put(&BlobHash::of_text("d"), "d").unwrap();
    drop(s);
    let mut s = store(dir.path());
    for t in ["", "中文🙂", "c", "d"] {
        assert_eq!(
            s.get(&BlobHash::of_text(t)).unwrap(),
            t,
            "{t:?} after reopen"
        );
    }
    assert!(!s.contains(&BlobHash::of_text("a")));
}

#[test]
fn compaction_refuses_a_kept_hash_the_pack_does_not_hold_and_writes_nothing() {
    let _turn = serial();
    let dir = tempfile::tempdir().unwrap();
    let mut s = store(dir.path());
    for t in ["a", "中文🙂"] {
        s.put(&BlobHash::of_text(t), t).unwrap();
    }
    let before = std::fs::read(dir.path().join(BLOB_PACK)).unwrap();
    let keep: BTreeSet<_> = ["a", "never stored"]
        .iter()
        .map(|t| BlobHash::of_text(t))
        .collect();
    let err = s
        .compact(&keep)
        .expect_err("a missing kept blob is refused");
    assert_eq!(err.code(), "JOURNAL_CORRUPT");
    assert!(
        err.to_string()
            .contains(BlobHash::of_text("never stored").as_str()),
        "{err}"
    );
    assert_eq!(
        std::fs::read(dir.path().join(BLOB_PACK)).unwrap(),
        before,
        "the pack is untouched"
    );
    assert_eq!(s.get(&BlobHash::of_text("中文🙂")).unwrap(), "中文🙂");
    assert!(
        s.compact(&BTreeSet::new()).is_ok(),
        "an empty keep set is fine"
    );
}

#[test]
fn a_blob_whose_content_does_not_match_its_hash_is_corrupt() {
    let _turn = serial();
    let dir = tempfile::tempdir().unwrap();
    let mut payload = BlobHash::of_text("x").as_str().as_bytes().to_vec();
    payload.extend_from_slice(b"\ny");
    let mut pack = encode(&payload);
    let mut later = BlobHash::of_text("z").as_str().as_bytes().to_vec();
    later.extend_from_slice(b"\nz");
    pack.extend(encode(&later));
    std::fs::write(dir.path().join(BLOB_PACK), pack).unwrap();
    let err = BlobStore::open(dir.path(), SyncPolicy::None, Arc::new(Faults::default()))
        .err()
        .expect("refused");
    assert_eq!(err.code(), "JOURNAL_CORRUPT");
    assert!(
        err.to_string().contains("does not match its content"),
        "{err}"
    );
}

#[test]
fn opening_a_large_pack_does_not_load_its_payloads() {
    let _turn = serial();
    let dir = tempfile::tempdir().unwrap();
    const BLOB: usize = 4 << 20;
    let mut s = store(dir.path());
    for i in 0..16u8 {
        let t = String::from_utf8(vec![b'a' + i; BLOB]).unwrap();
        s.put(&BlobHash::of_text(&t), &t).unwrap();
    }
    drop(s);
    let base = CURRENT.with(Cell::get);
    PEAK.with(|p| p.set(base));
    let mut s = store(dir.path());
    let grew = PEAK.with(Cell::get) - base;
    assert!(
        grew < 2 << 20,
        "open allocated {grew} bytes for a 64 MiB pack"
    );
    let t = String::from_utf8(vec![b'a' + 15; BLOB]).unwrap();
    assert_eq!(
        s.get(&BlobHash::of_text(&t)).unwrap(),
        t,
        "read on demand by offset"
    );
}
