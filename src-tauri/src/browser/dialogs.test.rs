//! Unit tests for the interactive JS-dialog completion registry (WI-1.7).
//!
//! The invariant under test is the one the page's JS depends on: a parked
//! `confirm()` completion is invoked **exactly once**, and is *never* dropped
//! without being invoked — a dropped block leaves the page's JavaScript blocked
//! on `confirm()` forever, with no way back.
//!
//! `PENDING`/`COUNTER` are thread-locals and each `#[test]` runs on its own
//! thread, so the tests are isolated without a reset hook.

use super::*;
use std::rc::Rc;

/// Every answer a completion block was invoked with, in order. Length is the
/// invocation count — "exactly once" is an assertion about this vec.
type Answers = Rc<RefCell<Vec<bool>>>;

/// A stand-in for WebKit's completion block: records every invocation and its
/// answer, so "exactly once" and "answered `false`" are both observable.
fn recorder() -> (RcBlock<dyn Fn(Bool)>, Answers) {
    let calls: Answers = Rc::new(RefCell::new(Vec::new()));
    let sink = calls.clone();
    let block = RcBlock::new(move |answer: Bool| sink.borrow_mut().push(answer.as_bool()));
    (block, calls)
}

#[test]
fn respond_delivers_the_answer_exactly_once() {
    let (block, calls) = recorder();
    let id = park_confirm("t1".into(), block);

    respond(id, true);
    assert_eq!(*calls.borrow(), vec![true]);

    // A duplicate response (double-click, retried IPC) must not call the block
    // twice — WebKit treats a second invocation as a hard error.
    respond(id, false);
    assert_eq!(*calls.borrow(), vec![true]);
}

#[test]
fn responding_to_an_unknown_id_is_a_no_op() {
    respond(999_999, true); // never parked — must not panic
    let (block, calls) = recorder();
    let id = park_confirm("t1".into(), block);
    respond(id + 1, true); // off-by-one id from a stale frontend dialog
    assert!(calls.borrow().is_empty());
}

#[test]
fn drain_cancels_only_the_named_tab_s_dialogs_with_false() {
    let (b1, c1) = recorder();
    let (b2, c2) = recorder();
    let (other, c_other) = recorder();
    let id1 = park_confirm("t1".into(), b1);
    let _id2 = park_confirm("t1".into(), b2);
    let id_other = park_confirm("t2".into(), other);

    drain_for("t1");

    // Both of t1's dialogs are cancelled (answered "false" = Cancel)…
    assert_eq!(*c1.borrow(), vec![false]);
    assert_eq!(*c2.borrow(), vec![false]);
    // …t2's is untouched and still answerable…
    assert!(c_other.borrow().is_empty());
    respond(id_other, true);
    assert_eq!(*c_other.borrow(), vec![true]);
    // …and a late response to a drained dialog is a no-op, not a second call.
    respond(id1, true);
    assert_eq!(*c1.borrow(), vec![false]);
}

#[test]
fn draining_a_tab_with_no_dialogs_is_a_no_op() {
    let (block, calls) = recorder();
    let id = park_confirm("t1".into(), block);
    drain_for("no-such-tab");
    assert!(calls.borrow().is_empty());
    respond(id, true);
    assert_eq!(*calls.borrow(), vec![true]);
}

#[test]
fn ids_stay_inside_javascript_s_safe_integer_range() {
    // Ids round-trip through the frontend as JSON numbers. Past 2^53 a u64 id
    // cannot come back intact, so the answer would be routed to the wrong dialog
    // (or to none at all). The counter wraps below the ceiling instead.
    set_counter(MAX_SAFE_ID - 1);
    let (b1, _) = recorder();
    assert_eq!(park_confirm("t1".into(), b1), MAX_SAFE_ID);

    let (b2, _) = recorder();
    let wrapped = park_confirm("t1".into(), b2);
    assert_eq!(wrapped, 1);
    assert!(wrapped <= MAX_SAFE_ID);
}

#[test]
fn a_wrapped_id_cancels_the_dialog_it_displaces_instead_of_dropping_it() {
    // `HashMap::insert` returning the old value used to be ignored: a colliding id
    // silently DROPPED a still-pending completion, hanging that page's JS forever.
    set_counter(MAX_SAFE_ID);
    let (first, first_calls) = recorder();
    let id = park_confirm("t1".into(), first);
    assert_eq!(id, 1);

    // Force the counter to hand out the same id again.
    set_counter(MAX_SAFE_ID);
    let (second, second_calls) = recorder();
    let same_id = park_confirm("t1".into(), second);
    assert_eq!(same_id, id);

    // The displaced dialog was cancelled, not dropped…
    assert_eq!(*first_calls.borrow(), vec![false]);
    // …and the id now answers the dialog that owns it.
    respond(same_id, true);
    assert_eq!(*second_calls.borrow(), vec![true]);
}
