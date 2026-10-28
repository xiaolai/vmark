//! The growth tests' counter, and the counted UTF-16 encoder. Every
//! primitive that reads a text or its headings counts what it reads here,
//! inside itself, so a caller that reads again is counted again: a
//! per-anchor re-read shows in `comment_list_cost`, wherever it is added.
//! Outside tests `add` is empty and inlined away.
//!
//! @module agent_journal/comment_anchor/work

/// `text` in UTF-16 code units, every unit counted.
pub(super) fn utf16(text: &str) -> Vec<u16> {
    let units: Vec<u16> = text.encode_utf16().collect();
    add(units.len());
    units
}

#[cfg(test)]
thread_local! {
    static UNITS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Count `n` units read on this thread.
#[cfg(test)]
pub(crate) fn add(n: usize) {
    UNITS.with(|u| u.set(u.get() + n as u64));
}

/// The units counted on this thread since the last take.
#[cfg(test)]
pub(crate) fn take() -> u64 {
    UNITS.with(|u| u.replace(0))
}

/// Counts nothing outside tests.
#[cfg(not(test))]
#[inline(always)]
pub(super) fn add(_n: usize) {}
