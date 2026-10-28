// WI-AL3.2 — the comment list's cost and its integrity: the window's text is encoded and its headings read once per list, and each thread's passage is found in one shared pass, so the work is linear in threads plus text, never their product, and the window's text is hashed before the writer lock is taken, so a long document never holds the writer for work linear in its text — also in a text of many headings, where each anchor's heading path is looked up in sections built once per list, never by walking the headings again per thread; an undeleted thread whose text the book lost fails the list as JOURNAL_CORRUPT instead of dropping the thread
//! Work is counted in text units the anchor resolver reads
//! (`comment_anchor::work`), not timed, so the growth check is exact.

use serde_json::json;

use super::comment_support::*;
use crate::agent_journal::admission::admission_support::KEY;
use crate::agent_journal::comment_anchor::work;

/// The text a window lists against: `TEXT` with the passage's suffix
/// changed, so each anchor falls through its context tier to the heading
/// path, then `units` of filler that holds no passage.
fn window_text(units: usize) -> String {
    let filler = "x\n".repeat(units / 2);
    format!("# Title\n\nhello there\n\n{filler}")
}

/// The window text with `count` headings before the passage's own
/// `# Title`, so finding its heading path has `count` headings to pass.
fn headed_text(count: usize) -> String {
    let before: String = (0..count).map(|i| format!("# H{i}\n\n")).collect();
    format!("{before}# Title\n\nhello there\n")
}

/// The resolver work of one list of `threads` threads against a window
/// text of about `units` UTF-16 units.
fn list_work(threads: usize, units: usize) -> u64 {
    work_against(threads, &window_text(units))
}

/// The resolver work of one list of `threads` threads against `text`.
fn work_against(threads: usize, text: &str) -> u64 {
    let (r, page) = rig();
    for i in 0..threads {
        create(&r, &page, &format!("note {i}")).expect("create");
    }
    let payload = json!({ "docKey": KEY, "text": text }).to_string();
    work::take();
    let out = r.c.comments_user().list(&payload).expect("list");
    assert_eq!(out.threads.len(), threads);
    let v = serde_json::to_value(&out.threads[0].anchor).expect("anchor");
    assert_eq!(v["status"], json!("resolved"), "{v}");
    assert_eq!(v["tier"], json!("headingPath"), "{v}");
    work::take()
}

#[test]
fn listing_costs_threads_plus_text_not_their_product() {
    let (t, n) = (8, 20_000);
    let base = list_work(t, n);
    let more_threads = list_work(4 * t, n);
    let more_text = list_work(t, 4 * n);
    let both = list_work(4 * t, 4 * n);
    // Linear in each: both ≈ more_threads + more_text − base. A product
    // would make `both` 16 × base, twice what the sum allows.
    assert!(
        both <= more_threads + more_text,
        "work: base {base}, ×4 threads {more_threads}, ×4 text {more_text}, both {both}"
    );
    // And the text is read a bounded number of times however many threads.
    assert!(
        more_threads < 2 * base,
        "×4 threads over the same text: {more_threads} vs {base}"
    );
}

#[test]
fn listing_against_many_headings_costs_threads_plus_headings_not_their_product() {
    let (t, h) = (8, 2_000);
    let base = work_against(t, &headed_text(h));
    let more_threads = work_against(4 * t, &headed_text(h));
    let more_headings = work_against(t, &headed_text(4 * h));
    let both = work_against(4 * t, &headed_text(4 * h));
    assert!(
        both <= more_threads + more_headings,
        "work: base {base}, ×4 threads {more_threads}, ×4 headings {more_headings}, both {both}"
    );
    assert!(
        more_threads < 2 * base,
        "×4 threads over the same headings: {more_threads} vs {base}"
    );
}

#[test]
fn an_undeleted_thread_without_its_text_fails_the_list_as_corrupt() {
    let (r, page) = rig();
    let c = comment_of(&create(&r, &page, "kept").expect("create"));
    create(&r, &page, "other").expect("create");
    inject(&r, |book| {
        book.texts.remove(&c);
    });
    let payload = json!({ "docKey": KEY, "text": TEXT }).to_string();
    let err =
        r.c.comments_user()
            .list(&payload)
            .expect_err("a lost thread text is never hidden");
    assert_eq!(code(&err), "JOURNAL_CORRUPT", "{err:?}");
    assert!(format!("{err:?}").contains(&c.to_string()), "{err:?}");
}

#[test]
fn the_window_text_is_hashed_before_the_writer_lock_is_taken() {
    use crate::agent_journal::ids::BlobHash;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let (r, page) = rig();
    create(&r, &page, "note").expect("create");
    let text = window_text(100_000);
    let payload = json!({ "docKey": KEY, "text": text }).to_string();
    let at_lock = Arc::new(AtomicU64::new(0));
    let seen = Arc::clone(&at_lock);
    BlobHash::take_hashed();
    // The hook runs on this thread, just before the list's writer lock.
    let hook = move || seen.store(BlobHash::take_hashed(), Ordering::SeqCst);
    r.c.writer.faults.before_nth_lock(1, Some(Box::new(hook)));
    r.c.comments_user().list(&payload).expect("list");
    r.c.writer.faults.before_nth_lock(0, None);
    let hashed = at_lock.load(Ordering::SeqCst);
    assert!(
        hashed >= text.len() as u64,
        "{hashed} bytes hashed before the lock, the text is {}",
        text.len()
    );
    assert!(
        BlobHash::take_hashed() < text.len() as u64,
        "the text is not hashed again under the lock"
    );
}
