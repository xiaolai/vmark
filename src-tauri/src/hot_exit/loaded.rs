//! Which file served a session, and at what cost.
//!
//! Split out of `session.rs` to keep it under the size gate. Re-exported from
//! `session` so consumers keep one import site.
//!
//! @coordinates-with storage.rs — sets these flags
//! @coordinates-with commands.rs — puts them on the wire as `InspectedSession`

use super::session::SessionData;

/// A session as it came off disk, paired with WHICH file served it.
///
/// `recovered_from_backup` is true when `session.json` could not be parsed,
/// migrated or validated and `session.prev.json` was substituted (audit
/// 20260803 §11). The substitution used to be silent, and silence is the
/// problem: it happens UPSTREAM of the frontend's salvage boundary, so the
/// payload arriving there is perfectly valid, nothing is quarantined, and a
/// successful restore clears both files — destroying the corrupt main bytes.
pub struct LoadedSession {
    pub session: SessionData,
    pub recovered_from_backup: bool,
    /// Set when the session was rebuilt by per-item salvage and CONTENT was
    /// dropped to make it loadable.
    ///
    /// Distinct from `recovered_from_backup`, which reports that a different
    /// FILE stood in. A lossy repair of the main file used to be reported as
    /// ordinary main data with the details only in the log, so a successful
    /// restore then deleted the original bytes and the dropped documents were
    /// gone for good (audit 20260906, B5/B6). The frontend uses this the same
    /// way it uses the backup flag: preserve the originals rather than clear
    /// them.
    pub lossy_repair: bool,
    /// What the lossy repair dropped, for the quarantine record. `None` when
    /// nothing was lost.
    pub repair_summary: Option<String>,
}

impl LoadedSession {
    /// The main file was usable.
    pub fn from_main(session: SessionData) -> Self {
        Self {
            session,
            recovered_from_backup: false,
            lossy_repair: false,
            repair_summary: None,
        }
    }

    /// The backup stood in for an unusable main file.
    pub fn from_backup(session: SessionData) -> Self {
        Self {
            session,
            recovered_from_backup: true,
            lossy_repair: false,
            repair_summary: None,
        }
    }

    /// Record that this session only loaded because salvage dropped content.
    pub fn with_lossy_repair(mut self, summary: String) -> Self {
        self.lossy_repair = true;
        self.repair_summary = Some(summary);
        self
    }
}
