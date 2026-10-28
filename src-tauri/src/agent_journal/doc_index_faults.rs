//! Failure injection for the identity index (`doc_index`): thread-local
//! switches tests set to fail an append or a rewrite at a chosen step. In
//! production builds every check is a no-op.
//!
//! @module agent_journal/doc_index_faults

#[cfg(test)]
thread_local! {
    /// Appends this thread may still make before one fails (tests only).
    pub(crate) static APPENDS_BEFORE_FAILURE: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
    /// The next rewrite on this thread fails before replacing the file
    /// (`Some(false)`) or reopening the new one (`Some(true)`); tests only.
    pub(crate) static REWRITE_FAILS_AFTER_REPLACE: std::cell::Cell<Option<bool>> =
        const { std::cell::Cell::new(None) };
}

/// The rewrite step `after_replace` names fails, when a test asked for it.
#[cfg(test)]
pub(super) fn injected(after_replace: bool) -> std::io::Result<()> {
    if REWRITE_FAILS_AFTER_REPLACE.with(|f| f.get()) != Some(after_replace) {
        return Ok(());
    }
    REWRITE_FAILS_AFTER_REPLACE.with(|f| f.set(None));
    Err(std::io::Error::other("injected index rewrite failure"))
}
#[cfg(not(test))]
pub(super) fn injected(_after_replace: bool) -> std::io::Result<()> {
    Ok(())
}

/// This append fails, when a test's countdown reached it.
#[cfg(test)]
pub(super) fn append_injected() -> std::io::Result<()> {
    let fail = APPENDS_BEFORE_FAILURE.with(|n| match n.get() {
        Some(0) => true,
        left => {
            n.set(left.map(|k| k - 1));
            false
        }
    });
    if fail {
        return Err(std::io::Error::other("injected index append failure"));
    }
    Ok(())
}
#[cfg(not(test))]
pub(super) fn append_injected() -> std::io::Result<()> {
    Ok(())
}
