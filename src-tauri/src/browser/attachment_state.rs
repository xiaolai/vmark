//! The authority's answer to "is this tab attached?" (audit 20260903 round 4, #37).
//! A `#[path]` child of `surface.rs`, re-exported from there so callers keep the
//! `surface::` address.
//!
//! The frontend keeps a MIRROR of human-tab attachments so it knows when to
//! re-prompt. Rust spends a one-use attachment inside `authorize_driver_op`; a
//! refusal raised before that consume leaves it, a failure after it has spent it.
//! The mirror used to infer which of the two happened from a denylist of error
//! tokens — a copy of `authorize.rs`'s ordering that drifted the moment the gate
//! gained a refusal (lock, script-size, target validation) the list did not name.
//! `browser_ai_attachment_state` reads the attachment the driver actually holds,
//! so the mirror re-syncs from the source of truth instead of guessing.
//!
//! @coordinates-with browser/tab_attachments.rs — the entries this reads
//! @coordinates-with browser/commands_auth.rs — `browser_ai_attachment_state`
//! @coordinates-with src/services/mcpBridge/v2/browserAttachmentMirror.ts — the reader

use crate::browser::surface::{BrowserSurface, TabAttachment};

/// What the driver holds for a tab. `attached: false` carries neither field; a
/// live attachment names the generation it is bound to and whether the NEXT
/// authorized operation spends it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AttachmentState {
    pub attached: bool,
    pub generation: Option<u64>,
    pub once: Option<bool>,
}

impl AttachmentState {
    pub const DETACHED: Self = Self {
        attached: false,
        generation: None,
        once: None,
    };

    /// The state of `tab_id` in `attachments` — at most one entry per tab
    /// (`tab_attachments::attach` replaces).
    pub(super) fn of(attachments: &[TabAttachment], tab_id: &str) -> Self {
        attachments
            .iter()
            .find(|attachment| attachment.tab_id == tab_id)
            .map_or(Self::DETACHED, |attachment| Self {
                attached: true,
                generation: Some(attachment.generation),
                once: Some(attachment.uses.is_some()),
            })
    }
}

impl BrowserSurface {
    /// Read-only: the attachment `tab_id` currently holds, as the authority sees
    /// it. A poisoned lock is an error, never a guessed `DETACHED` — the caller is
    /// asking precisely because it does not want to guess.
    pub fn attachment_state(&self, tab_id: &str) -> Result<AttachmentState, String> {
        let attachments = self.attachments.lock().map_err(|e| e.to_string())?;
        Ok(AttachmentState::of(&attachments, tab_id))
    }
}

#[cfg(test)]
#[path = "attachment_state.test.rs"]
mod tests;
