//! AI tab reservation and the request identity it is bound to (audit 20260903
//! round 3, #3).
//!
//! `browser_ai_create` is re-issued for an existing tab id on purpose: the React
//! surface and the MCP `navigate` verb both retry it for a tab whose creation
//! stopped at an approval prompt. It can also be re-issued by mistake — a second
//! window, or a client reusing an id. The retry used to be honoured on mode and
//! epoch alone, so a tab reserved by window A for url X could be resumed by
//! window B for url Y (the native view landing in B while the registry said A),
//! and a tab that had since navigated to Y answered a create for X with Y's
//! ticket.
//!
//! The entry now records the request that reserved it, and `reserve_ai_tab`
//! honours a later create ONLY as that same request: an identical one resumes
//! (no ticket yet) or is idempotent (its ticket is handed back, and only while
//! that ticket still targets the same url); every mismatch is refused, by kind,
//! before anything is authorized or created. The epoch and the AI-tab cap are
//! policy, checked by the command layer under the same guard (`ai_transactions`).

use super::{AutomationMode, BrowserRegistry, Entry};

/// The creation request an AI entry was reserved for; compared WHOLE on a retry.
/// The window and mode live on the entry itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AiCreation {
    pub(super) url: String,
    pub(super) profile: Option<String>,
}

/// A `browser_ai_create` request, as the registry sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiTabRequest<'a> {
    /// The INVOKING window, taken from Tauri — never a caller's claim.
    pub window_label: &'a str,
    pub mode: AutomationMode,
    /// The validated destination.
    pub url: &'a str,
    /// The profile that will actually apply: `None` unless the mode honours one.
    pub profile: Option<&'a str>,
    /// The AI posture epoch the tab is bound to.
    pub policy_epoch: u64,
}

/// What a reservation decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiReservation {
    /// A new entry was registered (`Creating`, generation 0): creation proceeds.
    Reserved,
    /// The same request reserved this tab before and never started its navigation
    /// (it stopped at an approval prompt): creation proceeds on the existing entry,
    /// whose current generation this is.
    Resumed { generation: u64 },
    /// The same request already started this tab's navigation: idempotent — this
    /// is its ticket.
    Existing { navigation_id: String },
}

/// Which part of the request identity an existing entry does not match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiRequestMismatch {
    /// The tab belongs to another window.
    Window,
    /// The tab was reserved for a different url (or never by an AI create at all).
    Url,
    /// The tab was reserved with a different profile.
    Profile,
    /// The tab's active navigation targets a different url: it has moved on, and
    /// its ticket is not this request's.
    Navigation,
}

impl AiRequestMismatch {
    /// The machine-readable kind a refusal carries in `detail.kind`.
    pub fn kind(self) -> &'static str {
        match self {
            Self::Window => "window",
            Self::Url => "url",
            Self::Profile => "profile",
            Self::Navigation => "navigation",
        }
    }
}

/// Why an existing entry refused the request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiReservationRefusal {
    /// The tab exists under a different automation mode (a human tab included).
    ProvenanceMismatch,
    /// The tab is being torn down: its id is unavailable until it is forgotten.
    Terminal,
    /// The tab exists, but this is not the request that reserved it.
    Mismatch(AiRequestMismatch),
}

impl BrowserRegistry {
    /// Reserve `tab_id` for `request`, or recognise `request` as the one that
    /// already reserved it. One guard, one decision — see the module doc.
    pub fn reserve_ai_tab(
        &mut self,
        tab_id: &str,
        request: &AiTabRequest<'_>,
    ) -> Result<AiReservation, AiReservationRefusal> {
        let Some(entry) = self.tabs.get(tab_id) else {
            let mut entry = Entry::new(request.window_label, request.mode);
            entry.policy_epoch = request.policy_epoch;
            entry.ai_request = Some(AiCreation {
                url: request.url.to_string(),
                profile: request.profile.map(str::to_owned),
            });
            self.tabs.insert(tab_id.to_string(), entry);
            return Ok(AiReservation::Reserved);
        };
        if entry.automation_mode != request.mode {
            return Err(AiReservationRefusal::ProvenanceMismatch);
        }
        if entry.state.is_terminal() {
            return Err(AiReservationRefusal::Terminal);
        }
        // The window before the url: a foreign window learns nothing about what
        // this tab was reserved for.
        if entry.window_label != request.window_label {
            return Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Window));
        }
        // An entry that recorded no request (a fixture, or an entry created outside
        // this path) equals no request.
        let Some(recorded) = entry.ai_request.as_ref() else {
            return Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Url));
        };
        if recorded.url != request.url {
            return Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Url));
        }
        if recorded.profile.as_deref() != request.profile {
            return Err(AiReservationRefusal::Mismatch(AiRequestMismatch::Profile));
        }
        match entry.active_navigation.as_ref() {
            Some(ticket) if ticket.requested_url != request.url => Err(
                AiReservationRefusal::Mismatch(AiRequestMismatch::Navigation),
            ),
            Some(ticket) => Ok(AiReservation::Existing {
                navigation_id: ticket.id.clone(),
            }),
            None => Ok(AiReservation::Resumed {
                generation: entry.generation,
            }),
        }
    }
}

#[cfg(test)]
#[path = "registry_ai.test.rs"]
mod tests;
