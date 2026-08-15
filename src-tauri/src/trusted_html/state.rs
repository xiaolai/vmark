//! The trusted-HTML grant registry.
//!
//! Purpose: hold the documents the user has explicitly authorized to execute,
//! keyed by an unguessable token and OWNED by the window that authorized them.
//! `protocol.rs` serves them; `commands.rs` mints and revokes them. Managed
//! state (`.manage()`, WI-20) rather than a static: every command that reaches
//! this carries an `AppHandle`, and a process-global would make one test's
//! grants visible to every other test in the binary.
//!
//! Three properties this module is responsible for:
//!
//! - **A grant only ever comes from `grant()`.** `publish()` refuses an unknown
//!   token instead of inserting one, so a caller that reaches the IPC boundary
//!   cannot mint a servable origin the user never authorized (issue #1273
//!   requirement 10).
//! - **The registry never sees a path.** Trust attaches to CONTENT the user
//!   authorized, not to a file name or an extension. The frontend owns the
//!   path→token association, in session-scoped memory.
//! - **Every grant has an owner, and dies with it.** `revoke_window` is what
//!   the window-destroy handler calls. An earlier version had no owner and a
//!   process-global sweep instead, which could not be wired anywhere safe:
//!   firing it on one window's teardown would have revoked every other
//!   window's trusted previews.
//!
//! Nothing is persisted. A grant lives until it is revoked, until its window is
//! destroyed, or until the process exits.
//!
//! @coordinates-with protocol.rs — reads `html()` to serve a response
//! @coordinates-with commands.rs — the IPC surface over this registry
//! @coordinates-with ../app_setup.rs — calls `revoke_window` on WindowEvent::Destroyed

use std::collections::HashMap;
use std::sync::Mutex;

use crate::command_error::{CommandError, ErrorCode};
use crate::secret_token::generate_secret_token;

/// Largest single document that may be granted, in bytes.
///
/// Generous next to real interactive documents — the physics-lab file that
/// motivated the feature is ~207 KB — but bounded, because the content is held
/// in memory for the life of the grant and arrives over IPC.
pub(crate) const MAX_DOC_BYTES: usize = 16 * 1024 * 1024;

/// Largest number of grants alive at once, across all windows.
pub(crate) const MAX_GRANTS: usize = 64;

/// Largest TOTAL resident HTML across all live grants.
///
/// The per-document cap and the grant count are independent, so on their own
/// they permitted `MAX_GRANTS × MAX_DOC_BYTES` — a gigabyte of resident text
/// reachable through an IPC surface. This is the bound that actually holds.
///
/// 64 MiB is four documents at the per-document cap, or roughly 300 at the size
/// of the motivating lab file, against a plausible working set of a handful of
/// trusted previews. It is deliberately the tightest of the three limits.
pub(crate) const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;

/// One authorized document.
struct Grant {
    /// Label of the window that authorized this. Its teardown revokes it.
    window: String,
    html: String,
}

/// Live grants plus the running byte total, behind one lock.
///
/// The total is stored rather than summed on demand: every admission decision
/// reads it, and recomputing under the lock would make each grant O(n) in the
/// number of live grants.
#[derive(Default)]
struct Registry {
    docs: HashMap<String, Grant>,
    bytes: usize,
}

#[derive(Default)]
pub struct TrustedHtmlState {
    inner: Mutex<Registry>,
}

impl TrustedHtmlState {
    /// Authorize `html` for execution on behalf of `window`, returning its token.
    ///
    /// The token is the app's standard 32-byte CSPRNG secret: it is the only
    /// thing standing between a live grant and any other frame that can name
    /// the scheme, so it must not be guessable.
    pub fn grant(&self, window: &str, html: String) -> Result<String, CommandError> {
        check_doc_size(&html)?;
        let mut reg = self.lock()?;
        if reg.docs.len() >= MAX_GRANTS {
            return Err(too_many());
        }
        check_budget(reg.bytes, 0, html.len())?;
        let token = generate_secret_token();
        reg.bytes += html.len();
        reg.docs.insert(
            token.clone(),
            Grant {
                window: window.to_string(),
                html,
            },
        );
        Ok(token)
    }

    /// Replace the document behind a LIVE token.
    ///
    /// Never creates a grant — an unknown token is `not-found`. This is what
    /// makes "the user authorized this" the only way a document becomes
    /// servable. Ownership is not transferable: the original window keeps it.
    pub fn publish(&self, token: &str, html: String) -> Result<(), CommandError> {
        check_doc_size(&html)?;
        let mut reg = self.lock()?;
        let previous = match reg.docs.get(token) {
            Some(grant) => grant.html.len(),
            None => return Err(CommandError::not_found("no such trusted-HTML grant")),
        };
        // A replacement costs the DELTA, not the whole new document. Charging
        // the full size would refuse a shrink once the budget was near full.
        check_budget(reg.bytes, previous, html.len())?;
        reg.bytes = reg.bytes - previous + html.len();
        if let Some(grant) = reg.docs.get_mut(token) {
            grant.html = html;
        }
        Ok(())
    }

    /// Drop a grant. Returns whether it existed, so a double revoke is a
    /// no-op rather than an error.
    pub fn revoke(&self, token: &str) -> bool {
        let Ok(mut reg) = self.lock() else {
            return false;
        };
        match reg.docs.remove(token) {
            Some(grant) => {
                reg.bytes -= grant.html.len();
                true
            }
            None => false,
        }
    }

    /// Drop every grant owned by `window`, returning how many. Called from the
    /// native `WindowEvent::Destroyed` handler.
    pub fn revoke_window(&self, window: &str) -> usize {
        let Ok(mut reg) = self.lock() else {
            return 0;
        };
        let doomed: Vec<String> = reg
            .docs
            .iter()
            .filter(|(_, grant)| grant.window == window)
            .map(|(token, _)| token.clone())
            .collect();
        for token in &doomed {
            if let Some(grant) = reg.docs.remove(token) {
                reg.bytes -= grant.html.len();
            }
        }
        doomed.len()
    }

    /// The document behind a token, if the grant is live.
    pub fn html(&self, token: &str) -> Option<String> {
        self.lock().ok()?.docs.get(token).map(|g| g.html.clone())
    }

    /// Number of live grants. Test-only: production code asks whether a
    /// specific token resolves, never how many exist.
    #[cfg(test)]
    pub fn grant_count(&self) -> usize {
        self.lock().map(|reg| reg.docs.len()).unwrap_or(0)
    }

    /// Total resident HTML. Test-only — the accounting is what needs pinning.
    #[cfg(test)]
    pub fn total_bytes(&self) -> usize {
        self.lock().map(|reg| reg.bytes).unwrap_or(0)
    }

    /// A poisoned lock means another thread panicked mid-mutation; the honest
    /// answer is to refuse rather than serve a half-updated registry.
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Registry>, CommandError> {
        self.inner
            .lock()
            .map_err(|_| CommandError::internal("trusted-HTML registry unavailable"))
    }
}

fn check_doc_size(html: &str) -> Result<(), CommandError> {
    if html.len() > MAX_DOC_BYTES {
        return Err(crate::localized_error!(
            ErrorCode::InvalidInput,
            "errors.trustedHtml.tooLarge",
            limit = (MAX_DOC_BYTES / (1024 * 1024)).to_string()
        ));
    }
    Ok(())
}

/// Would replacing `previous` bytes with `incoming` fit the aggregate budget?
fn check_budget(current: usize, previous: usize, incoming: usize) -> Result<(), CommandError> {
    if current - previous + incoming > MAX_TOTAL_BYTES {
        return Err(crate::localized_error!(
            ErrorCode::InvalidInput,
            "errors.trustedHtml.budgetExhausted",
            limit = (MAX_TOTAL_BYTES / (1024 * 1024)).to_string()
        ));
    }
    Ok(())
}

fn too_many() -> CommandError {
    crate::localized_error!(
        ErrorCode::InvalidInput,
        "errors.trustedHtml.tooMany",
        limit = MAX_GRANTS.to_string()
    )
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
