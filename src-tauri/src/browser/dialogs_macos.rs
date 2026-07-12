//! Interactive JS-dialog completion registry for the embedded browser (WI-1.7).
//!
//! A WKUIDelegate `confirm()` panel hands us an ObjC completion block that must
//! be called with the user's answer — but the answer only arrives after a VMark
//! dialog and a frontend round-trip. So we COPY the block (retaining it beyond
//! the delegate call), park it here keyed by a dialog id, and call it once
//! `browser_dialog_respond` comes back. If the tab is torn down while a dialog is
//! still open, `drain_for` cancels every pending block so the page's blocked JS
//! never hangs a dead webview.
//!
//! Main-thread-only: the blocks are WebKit's, created and invoked on the main
//! thread, and `RcBlock` is not `Send`. A `#[path]` submodule of `imp`.

use block2::RcBlock;
use objc2::runtime::Bool;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

struct Pending {
    tab_id: String,
    block: RcBlock<dyn Fn(Bool)>,
}

thread_local! {
    static PENDING: RefCell<HashMap<u64, Pending>> = RefCell::new(HashMap::new());
    static COUNTER: Cell<u64> = const { Cell::new(0) };
}

/// Park a `confirm()` completion, returning its dialog id (for the emitted event).
pub(super) fn park_confirm(tab_id: String, block: RcBlock<dyn Fn(Bool)>) -> u64 {
    let id = COUNTER.with(|c| {
        let n = c.get().wrapping_add(1);
        c.set(n);
        n
    });
    PENDING.with(|m| m.borrow_mut().insert(id, Pending { tab_id, block }));
    id
}

/// Answer a parked dialog. No-op on an unknown id (already answered or drained).
pub(super) fn respond(id: u64, accepted: bool) {
    let pending = PENDING.with(|m| m.borrow_mut().remove(&id));
    if let Some(p) = pending {
        p.block.call((Bool::new(accepted),));
    }
}

/// Cancel every pending dialog for `tab_id` (called on teardown) so the page's
/// blocked JS is released before its webview goes away.
pub(super) fn drain_for(tab_id: &str) {
    let drained: Vec<Pending> = PENDING.with(|m| {
        let mut map = m.borrow_mut();
        let ids: Vec<u64> = map
            .iter()
            .filter(|(_, p)| p.tab_id == tab_id)
            .map(|(k, _)| *k)
            .collect();
        ids.into_iter().filter_map(|id| map.remove(&id)).collect()
    });
    for p in drained {
        p.block.call((Bool::new(false),));
    }
}
