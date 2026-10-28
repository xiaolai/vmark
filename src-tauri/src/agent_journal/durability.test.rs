// WI-AL1.2 — crash injection: framing, truncation at every byte, torn and zero tails, damage before the tail refused, compaction crash at every step
//! WI-AL0.2 — framing, byte-boundary crash injection, malformed-tail
//! truncation, append rollback, compaction temp → fsync → rename → dir fsync.

use std::sync::Arc;

use crate::agent_journal::faults::{CompactionStep, Faults};
use crate::agent_journal::frame::{self, Tail, HEADER_LEN};
use crate::agent_journal::journal_file::{JournalFile, SyncPolicy, JOURNAL_FILE};

fn payloads(n: usize) -> Vec<Vec<u8>> {
    (0..n)
        .map(|i| format!("{{\"i\":{i},\"t\":\"中文🙂\"}}").into_bytes())
        .collect()
}

fn open(dir: &std::path::Path) -> crate::agent_journal::journal_file::Opened {
    JournalFile::open(
        &dir.join(JOURNAL_FILE),
        SyncPolicy::Full,
        Arc::new(Faults::default()),
    )
    .expect("open")
}

#[test]
fn frames_round_trip_and_empty_input_is_clean() {
    let bytes: Vec<u8> = payloads(3).iter().flat_map(|p| frame::encode(p)).collect();
    let scan = frame::scan(&bytes).unwrap();
    assert_eq!(
        scan.frames
            .iter()
            .map(|f| f.payload.clone())
            .collect::<Vec<_>>(),
        payloads(3)
    );
    assert_eq!(
        (scan.valid_len, scan.tail),
        (bytes.len() as u64, Tail::Clean)
    );
    let empty = frame::scan(&[]).unwrap();
    assert!(empty.frames.is_empty());
    assert_eq!(empty.tail, Tail::Clean);
    let zero = frame::encode(b"");
    assert_eq!(zero.len(), HEADER_LEN, "an empty payload is a valid frame");
}

#[test]
fn truncation_at_every_byte_of_the_last_frame_keeps_it_whole_or_drops_it() {
    let ps = payloads(3);
    let full: Vec<u8> = ps.iter().flat_map(|p| frame::encode(p)).collect();
    let last_start = full.len() - frame::encode(&ps[2]).len();
    for cut in last_start..=full.len() {
        let dir = super::test_support::tmp();
        std::fs::write(dir.path().join(JOURNAL_FILE), &full[..cut]).unwrap();
        let opened = open(dir.path());
        let got = opened.payloads.clone();
        if cut == full.len() {
            assert_eq!(got, ps, "cut={cut}: whole");
        } else {
            assert_eq!(got, ps[..2].to_vec(), "cut={cut}: not at all");
            assert_eq!(opened.truncated_tail_bytes, (cut - last_start) as u64);
        }
        // The file was truncated to the valid prefix, and an append after
        // recovery lands on a clean boundary.
        let mut f = opened.file;
        f.append(b"after").unwrap();
        drop(f); // the process ends: its journal lock is released
        let again = open(dir.path());
        assert_eq!(again.payloads.last().unwrap(), b"after", "cut={cut}");
        assert_eq!(again.truncated_tail_bytes, 0);
    }
}

#[test]
fn checksum_damage_in_the_final_frame_is_a_torn_tail() {
    let ps = payloads(2);
    let mut full: Vec<u8> = ps.iter().flat_map(|p| frame::encode(p)).collect();
    let n = full.len();
    full[n - 1] ^= 0xff;
    let scan = frame::scan(&full).unwrap();
    assert_eq!(scan.frames.len(), 1);
    assert!(matches!(scan.tail, Tail::Torn { .. }));
}

#[test]
fn a_zero_filled_tail_is_torn_not_corrupt() {
    let mut full = frame::encode(b"one");
    full.extend(std::iter::repeat_n(0u8, 4096));
    let scan = frame::scan(&full).unwrap();
    assert_eq!(scan.frames.len(), 1);
    assert_eq!(
        scan.tail,
        Tail::Torn {
            at: full.len() as u64 - 4096,
            bytes: 4096
        }
    );
}

#[test]
fn damage_before_the_last_frame_is_refused_not_truncated() {
    let ps = payloads(3);
    let mut full: Vec<u8> = ps.iter().flat_map(|p| frame::encode(p)).collect();
    full[HEADER_LEN + 1] ^= 0xff; // payload byte of the first frame
    let dir = super::test_support::tmp();
    let path = dir.path().join(JOURNAL_FILE);
    std::fs::write(&path, &full).unwrap();
    let err = JournalFile::open(&path, SyncPolicy::Full, Arc::new(Faults::default()))
        .err()
        .expect("refused");
    assert_eq!(err.code(), "JOURNAL_CORRUPT");
    assert_eq!(std::fs::read(&path).unwrap(), full, "nothing was truncated");
}

#[test]
fn a_failed_partial_append_is_rolled_back_so_later_appends_survive() {
    let dir = super::test_support::tmp();
    let faults = Arc::new(Faults::default());
    let path = dir.path().join(JOURNAL_FILE);
    let mut f = JournalFile::open(&path, SyncPolicy::Full, faults.clone())
        .unwrap()
        .file;
    f.append(b"first").unwrap();
    faults.tear_next_append_after(7);
    assert_eq!(f.append(b"second-torn").unwrap_err().code(), "JOURNAL_IO");
    f.append(b"third").unwrap();
    drop(f);
    let opened = open(dir.path());
    assert_eq!(opened.payloads, vec![b"first".to_vec(), b"third".to_vec()]);
    assert_eq!(
        opened.truncated_tail_bytes, 0,
        "no torn frame was left mid-file"
    );
}

#[test]
fn rollback_holds_when_the_next_append_is_shorter_or_never_comes() {
    let dir = super::test_support::tmp();
    let faults = Arc::new(Faults::default());
    let path = dir.path().join(JOURNAL_FILE);
    let mut f = JournalFile::open(&path, SyncPolicy::Full, faults.clone())
        .unwrap()
        .file;
    f.append(b"first").unwrap();
    faults.tear_next_append_after(60);
    assert!(f.append(&[b'z'; 200]).is_err());
    assert_eq!(f.len(), (HEADER_LEN + 5) as u64);
    assert_eq!(
        std::fs::metadata(&path).unwrap().len(),
        f.len(),
        "torn bytes removed, not left for a later overwrite"
    );
    f.append(b"x").unwrap(); // shorter than the torn bytes
    drop(f);
    let opened = open(dir.path());
    assert_eq!(opened.payloads, vec![b"first".to_vec(), b"x".to_vec()]);
    assert_eq!(opened.truncated_tail_bytes, 0);
}

#[test]
fn compaction_crash_at_every_step_leaves_old_or_new_journal_whole() {
    let old = payloads(4);
    let new = vec![b"compacted".to_vec()];
    for step in [
        CompactionStep::TempWritten,
        CompactionStep::TempSynced,
        CompactionStep::Renamed,
        CompactionStep::DirSynced,
    ] {
        let dir = super::test_support::tmp();
        let faults = Arc::new(Faults::default());
        let path = dir.path().join(JOURNAL_FILE);
        let mut f = JournalFile::open(&path, SyncPolicy::Full, faults.clone())
            .unwrap()
            .file;
        for p in &old {
            f.append(p).unwrap();
        }
        faults.crash_compaction_after(step);
        assert!(f.rewrite(&new).is_err(), "{step:?}: injected crash");
        drop(f); // the crash ends the process, releasing its lock
        let got = open(dir.path()).payloads;
        match step {
            CompactionStep::Renamed | CompactionStep::DirSynced => {
                assert_eq!(got, new, "{step:?}");
            }
            _ => assert_eq!(got, old, "{step:?}"),
        }
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "{step:?}: stale temp removed at open: {leftovers:?}"
        );
    }
}

#[test]
fn compaction_success_replaces_the_file_and_appends_continue() {
    let dir = super::test_support::tmp();
    let opened = open(dir.path());
    let mut f = opened.file;
    for p in payloads(5) {
        f.append(&p).unwrap();
    }
    f.rewrite(&payloads(2)).unwrap();
    f.append(b"tail").unwrap();
    let mut want = payloads(2);
    want.push(b"tail".to_vec());
    drop(f);
    assert_eq!(open(dir.path()).payloads, want);
}

#[test]
fn a_second_opener_is_refused_while_the_journal_is_held_and_leaves_its_temp_alone() {
    let dir = super::test_support::tmp();
    let path = dir.path().join(JOURNAL_FILE);
    let held = open(dir.path()).file;
    // Another process mid-compaction: its temp file must survive our attempt.
    let tmp = dir.path().join(format!("{JOURNAL_FILE}.tmp"));
    std::fs::write(&tmp, b"staged by the holder").unwrap();
    let err = JournalFile::open(&path, SyncPolicy::Full, Arc::new(Faults::default()))
        .err()
        .expect("a second opener is refused");
    assert_eq!(err.code(), "JOURNAL_IO");
    assert!(tmp.exists(), "the holder's temp file is untouched");
    let streamed = JournalFile::open_stream(
        &path,
        SyncPolicy::Full,
        Arc::new(Faults::default()),
        &mut NullSink,
    );
    assert!(streamed.is_err(), "the streaming opener is refused too");
    drop(held);
    open(dir.path());
    assert!(!tmp.exists(), "released at drop; the next opener cleans up");
}

struct NullSink;

impl frame::FrameSink for NullSink {
    fn chunk(&mut self, _: &[u8]) -> Result<(), String> {
        Ok(())
    }
    fn frame(&mut self, _: u64, _: u64) -> Result<(), String> {
        Ok(())
    }
    fn discard(&mut self) {}
}

#[test]
fn a_lock_held_only_for_a_moment_is_waited_out() {
    // A child forked by this process holds the lock until it execs.
    let dir = super::test_support::tmp();
    let held = open(dir.path()).file;
    let release = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        drop(held);
    });
    open(dir.path());
    release.join().unwrap();
}

/// Creating the journal fsyncs its directory (as compaction's rename does),
/// so the first acknowledged append cannot vanish with the file's name.
#[test]
fn creating_the_journal_syncs_its_directory_and_reopening_does_not() {
    use crate::agent_journal::journal_file::DIR_SYNCS;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(JOURNAL_FILE);
    struct Ignore;
    impl crate::agent_journal::frame::FrameSink for Ignore {
        fn chunk(&mut self, _: &[u8]) -> Result<(), String> {
            Ok(())
        }
        fn frame(&mut self, _: u64, _: u64) -> Result<(), String> {
            Ok(())
        }
        fn discard(&mut self) {}
    }
    let mut sink = Ignore;
    DIR_SYNCS.with(|d| d.borrow_mut().clear());
    let (mut f, _) =
        JournalFile::open_stream(&path, SyncPolicy::Full, Arc::default(), &mut sink).unwrap();
    assert_eq!(DIR_SYNCS.with(|d| d.take()), vec![dir.path().to_path_buf()]);
    f.append(b"{}").unwrap();
    drop(f);
    JournalFile::open_stream(&path, SyncPolicy::Full, Arc::default(), &mut sink).unwrap();
    assert!(DIR_SYNCS.with(|d| d.take()).is_empty(), "reopened: none");
}

/// The journal directory's own name is durable too: every directory the
/// writer creates has its parent fsynced, outermost first, and an existing
/// directory costs no sync.
#[test]
fn creating_the_journal_directory_syncs_each_new_parent() {
    use crate::agent_journal::journal_file::DIR_SYNCS;
    use crate::agent_journal::writer::{Writer, WriterConfig};
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("a").join("b");
    let cfg = || WriterConfig {
        dir: dir.clone(),
        sync: SyncPolicy::Full,
        faults: Arc::default(),
    };
    DIR_SYNCS.with(|d| d.borrow_mut().clear());
    drop(Writer::open(cfg()).unwrap());
    let synced = DIR_SYNCS.with(|d| d.take());
    assert_eq!(
        synced[..2],
        [root.path().to_path_buf(), root.path().join("a")],
        "{synced:?}"
    );
    drop(Writer::open(cfg()).unwrap());
    let synced = DIR_SYNCS.with(|d| d.take());
    assert!(!synced.contains(&root.path().to_path_buf()), "{synced:?}");
    assert!(!synced.contains(&root.path().join("a")), "{synced:?}");
}

/// A file removed between the existence check and the open is re-created by
/// that open: its new name must be synced like any created file's.
#[test]
fn a_file_replaced_between_the_check_and_the_open_still_syncs_its_directory() {
    use crate::agent_journal::journal_file::{open_created, rw_options, DIR_SYNCS};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.jsonl");
    std::fs::write(&path, b"old").unwrap();
    // The second open (of the existing file, after `create_new` found it)
    // runs just after the file is removed.
    let opens = std::cell::Cell::new(0);
    let racing = || {
        opens.set(opens.get() + 1);
        if opens.get() == 2 {
            std::fs::remove_file(&path).unwrap();
        }
        rw_options()
    };
    DIR_SYNCS.with(|d| d.borrow_mut().clear());
    let f = open_created(&path, racing, true).unwrap();
    assert_eq!(f.metadata().unwrap().len(), 0, "a new file was opened");
    assert_eq!(DIR_SYNCS.with(|d| d.take()), vec![dir.path().to_path_buf()]);
}
