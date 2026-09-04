//! Human-tab attachments: the ephemeral, generation-bound consent that lets the
//! AI act on a HUMAN tab (WI-2.1). Split from `surface.rs` at the file-size limit;
//! a `#[path]` child of it, re-exported from there so callers keep the
//! `surface::` address.
//!
//! An attachment binds to exactly (tab, generation), so it cannot follow a page
//! navigation or a reused tab id — and since audit 20260903 round 3 #35 it is
//! WRITTEN only under the registry guard, for a tab the registry knows at that
//! generation (`BrowserSurface::attach_tab`), and CLEARED under that same guard
//! when the tab is forgotten (`BrowserSurface::forget_tab`). The two free
//! functions here work on an already-held guard, so the authorization gate can
//! hold the attachments lock from its presence check through the consume
//! (`authorize_spend.rs`).
//!
//! @coordinates-with browser/surface.rs — `attach_tab`, `forget_tab`, the guards
//! @coordinates-with browser/authorize_spend.rs — presence check + consume

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabAttachment {
    pub tab_id: String,
    pub generation: u64,
    /// Remaining uses for a single-use attachment; `None` is persistent.
    pub uses: Option<u8>,
}

/// Replace any attachment for `tab_id` with one bound to `generation`; `once`
/// makes it single-use. On an already-held guard, so the caller decides what is
/// held around the write.
pub(super) fn attach(
    attachments: &mut Vec<TabAttachment>,
    tab_id: String,
    generation: u64,
    once: bool,
) {
    attachments.retain(|attachment| attachment.tab_id != tab_id);
    attachments.push(TabAttachment {
        tab_id,
        generation,
        uses: once.then_some(1),
    });
}

/// Is there an attachment for exactly this tab + generation? A peek — no consume.
pub(crate) fn attachment_present(
    attachments: &[TabAttachment],
    tab_id: &str,
    generation: u64,
) -> bool {
    attachments
        .iter()
        .any(|attachment| attachment.tab_id == tab_id && attachment.generation == generation)
}

/// Consume a matching attachment on an already-held guard: decrement a one-use
/// count (removing it at zero) and return whether one was present. A persistent
/// attachment (`uses = None`) is left in place and still returns true. Kept as a
/// free function so the authorization gate can hold the attachments lock across a
/// one-shot spend (see `authorize_spend.rs`): the presence check and the consume
/// then cannot be raced apart, so a one-shot is never burned for an action a lost
/// attachment race would deny.
pub(crate) fn consume_attachment_in(
    attachments: &mut Vec<TabAttachment>,
    tab_id: &str,
    generation: u64,
) -> bool {
    let Some(index) = attachments
        .iter()
        .position(|attachment| attachment.tab_id == tab_id && attachment.generation == generation)
    else {
        return false;
    };
    if let Some(uses) = attachments[index].uses.as_mut() {
        if *uses == 0 {
            attachments.remove(index);
            return false;
        }
        *uses -= 1;
        if *uses == 0 {
            attachments.remove(index);
        }
    }
    true
}
