//! Per-item salvage for a session file that the strict parser rejects.
//!
//! Purpose: recover the healthy documents out of a session whose typed
//! deserialization fails as a whole.
//!
//! `SessionData` is deserialized with serde in one shot, so ONE bad element
//! rejects everything around it: a `null` in the tab array, a UI field that is
//! missing, or a cosmetic `sidebar_width: 260.5` where the schema says `u32`.
//! The frontend already implements exactly the recovery this should trigger
//! (`sessionSalvage.ts`: one invalid tab must not cost its healthy siblings,
//! and a cosmetic field must not block document recovery) — but it never got
//! the chance, because Rust returned `None`, the same shape as "no session at
//! all" (audit 20260906, B6).
//!
//! The order here is the point: inspect as raw JSON, drop or repair individual
//! items, and only then build the typed structure. Salvage must come BEFORE the
//! strict conversion, not after it.
//!
//! What this deliberately does NOT do is loosen `SessionData`. The typed schema
//! stays strict, so ordinary reads keep their guarantees; this is a second,
//! explicitly lossy pass that runs only once the strict one has already failed,
//! and it reports what it dropped so the caller can quarantine the original.
//!
//! @coordinates-with storage.rs — calls this when strict parsing fails
//! @coordinates-with session.rs — the typed structures this produces
//! @coordinates-with src/services/persistence/hotExit/sessionSalvage.ts

use serde_json::Value;

use super::session::SessionData;

/// A session rebuilt from raw JSON, plus what it cost.
#[derive(Debug)]
pub struct SalvagedSession {
    pub session: SessionData,
    /// Tabs that could not be converted and were dropped.
    pub dropped_tabs: usize,
    /// Windows that could not be converted and were dropped.
    pub dropped_windows: usize,
    /// Cosmetic UI fields that were normalized (e.g. a fractional width).
    pub repaired_fields: usize,
}

impl SalvagedSession {
    /// Whether anything was actually lost, as opposed to merely tidied.
    ///
    /// A normalized `sidebar_width` is not a loss; a dropped tab is. The caller
    /// uses this to decide whether the original file must be preserved for
    /// manual recovery rather than cleared after a successful restore.
    pub fn is_lossy(&self) -> bool {
        self.dropped_tabs > 0 || self.dropped_windows > 0
    }

    /// A human-readable account of the repair, for logs and provenance.
    pub fn summary(&self) -> String {
        format!(
            "dropped {} tab(s), dropped {} window(s), normalized {} field(s)",
            self.dropped_tabs, self.dropped_windows, self.repaired_fields
        )
    }
}

/// Round any fractional number in a UI-state object to an integer.
///
/// Integer-typed cosmetic fields (`sidebar_width`, `terminal_height`,
/// geometry) are the ones a drag can plausibly leave fractional, and losing a
/// document because a panel is 260.5 pixels wide is absurd. Rounding is applied
/// only to numbers that are not already integers, so nothing else is touched.
fn round_fractional_numbers(value: &mut Value, repaired: &mut usize) {
    match value {
        Value::Number(n) => {
            // Already an integer on the wire — leave it exactly as it is.
            if n.as_i64().is_some() || n.as_u64().is_some() {
                return;
            }
            if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    // Built from an i64 so serde sees an INTEGER;
                    // `Number::from_f64` would keep it float-typed and the
                    // strict `u32` field would reject it all over again.
                    *value = Value::Number(serde_json::Number::from(f.round() as i64));
                    *repaired += 1;
                }
            }
        }
        Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                round_fractional_numbers(v, repaired);
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                round_fractional_numbers(v, repaired);
            }
        }
        _ => {}
    }
}

/// Rebuild a session from raw JSON, discarding only the items that cannot be
/// converted.
///
/// Returns `None` when the envelope itself is unusable — malformed JSON, a
/// non-object root, or missing version/timestamp — because there is then
/// nothing to anchor a restore to and the backup file is the better bet.
pub fn salvage_session(contents: &str) -> Option<SalvagedSession> {
    let raw: Value = serde_json::from_str(contents).ok()?;
    let root = raw.as_object()?;

    // The envelope has to be intact: without a version we cannot know which
    // migration applies, and inventing one risks misreading every field below.
    let version = root.get("version")?.as_u64()? as u32;
    let timestamp = root.get("timestamp")?.as_i64()?;
    let vmark_version = root
        .get("vmark_version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut dropped_tabs = 0usize;
    let mut dropped_windows = 0usize;
    let mut repaired_fields = 0usize;

    let mut windows = Vec::new();
    for window in root.get("windows").and_then(Value::as_array)?.iter() {
        let Some(window_obj) = window.as_object() else {
            dropped_windows += 1;
            continue;
        };
        let mut window_value = Value::Object(window_obj.clone());

        // Convert tabs one at a time so a single bad entry costs only itself.
        let salvaged_tabs: Vec<Value> = window_obj
            .get("tabs")
            .and_then(Value::as_array)
            .map(|tabs| {
                tabs.iter()
                    .filter(|tab| {
                        let mut candidate = (*tab).clone();
                        round_fractional_numbers(&mut candidate, &mut 0);
                        let ok =
                            serde_json::from_value::<super::session::TabState>(candidate).is_ok();
                        if !ok {
                            dropped_tabs += 1;
                        }
                        ok
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();

        if let Some(obj) = window_value.as_object_mut() {
            obj.insert("tabs".to_string(), Value::Array(salvaged_tabs));
        }
        round_fractional_numbers(&mut window_value, &mut repaired_fields);

        match serde_json::from_value::<super::session::WindowState>(window_value) {
            Ok(state) => windows.push(state),
            Err(e) => {
                log::warn!("[HotExit] Salvage dropped an unreadable window: {e}");
                dropped_windows += 1;
            }
        }
    }

    // A session with no recoverable window carries nothing to restore; let the
    // backup arm try instead of returning an empty success.
    if windows.is_empty() {
        return None;
    }

    // The workspace block is auxiliary: losing it costs layout, not documents.
    let workspace = root
        .get("workspace")
        .cloned()
        .and_then(|w| serde_json::from_value(w).ok());

    Some(SalvagedSession {
        session: SessionData {
            version,
            timestamp,
            vmark_version,
            windows,
            workspace,
        },
        dropped_tabs,
        dropped_windows,
        repaired_fields,
    })
}

/// A session file read, plus whether per-item salvage was needed to read it.
pub(super) struct ReadSession {
    pub session: SessionData,
    /// `Some` when the strict parse failed and salvage DROPPED content to
    /// produce this session. Carries the human-readable account.
    pub lossy_repair: Option<String>,
}

/// Read and parse a session file, falling back to per-item salvage when the
/// strict typed parse rejects the whole file.
///
/// Strict first, always: an ordinary session must keep every guarantee the
/// typed schema gives it, and salvage is explicitly lossy. But a whole-file
/// parse means one `null` in the tab array — or a cosmetic
/// `sidebar_width: 260.5` against a `u32` — discarded every healthy unsaved
/// document beside it, and returned the same `None` as "there is no session",
/// so the frontend's own per-tab salvage never ran (audit 20260906, B6).
pub(super) async fn read_session_file_with_salvage(
    path: &std::path::Path,
) -> Result<Option<ReadSession>, String> {
    let contents = match tokio::fs::read_to_string(path).await {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };

    match serde_json::from_str::<SessionData>(&contents) {
        Ok(session) => Ok(Some(ReadSession {
            session,
            lossy_repair: None,
        })),
        Err(strict_error) => match super::salvage::salvage_session(&contents) {
            Some(salvaged) => {
                let summary = salvaged.summary();
                log::warn!(
                    "[HotExit] Strict parse of {} failed ({strict_error}); salvaged: {summary}",
                    path.display()
                );
                // Only a repair that LOST something needs the original
                // preserved. Normalizing a fractional panel width is not a
                // loss and must not trigger a quarantine every launch.
                let lossy_repair = salvaged.is_lossy().then_some(summary);
                Ok(Some(ReadSession {
                    session: salvaged.session,
                    lossy_repair,
                }))
            }
            None => Err(format!(
                "Failed to parse {}: {}",
                path.display(),
                strict_error
            )),
        },
    }
}

#[cfg(test)]
#[path = "salvage.test.rs"]
mod tests;
