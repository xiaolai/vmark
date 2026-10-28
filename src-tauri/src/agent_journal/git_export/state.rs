//! The durable record of what each export branch should point at, kept
//! beside the journal (never in the repository).
//!
//! Commit ids are content hashes of their whole ancestry, so "the tip is the
//! commit VMark last wrote" proves the branch still holds exactly what VMark
//! exported; trailers alone could be copied onto rewritten content. One
//! entry per (document, repository common directory): `commit` is the
//! confirmed tip, `pending` the tip an export is about to swap in. The
//! pending value is written before the ref moves and cleared after, so a
//! crash between the two still recognises VMark's own commit next time.
//!
//! The file is rewritten whole through a synced temporary file, a rename and
//! a directory sync. The command layer serializes exports in one process.
//!
//! @module agent_journal/git_export/state

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::ExportError;
use crate::agent_journal::ids::DocId;

/// The file name under the journal directory.
pub const STATE_FILE: &str = "git-exports.json";

/// What the branch may point at without being a conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    pub commit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<String>,
}

impl Expected {
    /// True when `tip` is a commit VMark wrote for this entry.
    pub fn accepts(&self, tip: &str) -> bool {
        self.commit == tip || self.pending.as_deref() == Some(tip)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    doc: String,
    repository: String,
    #[serde(flatten)]
    expected: Expected,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateFile {
    version: u32,
    entries: Vec<Entry>,
}

const VERSION: u32 = 1;

/// The state file at one path.
#[derive(Debug, Clone)]
pub struct ExportState {
    path: PathBuf,
}

/// The disk failed reading or writing the file.
fn io(what: &str, e: impl std::fmt::Display) -> ExportError {
    ExportError::StateIo(format!("{what}: {e}"))
}

/// The file's content cannot be trusted.
fn bad(what: &str, e: impl std::fmt::Display) -> ExportError {
    ExportError::Journal(format!("export state {what}: {e}"))
}

impl ExportState {
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    /// The file under a journal directory.
    pub fn in_dir(dir: &Path) -> Self {
        Self::at(dir.join(STATE_FILE))
    }

    /// The expectation for `doc` in `repository`, if VMark exported there.
    pub fn expected(&self, doc: DocId, repository: &str) -> Result<Option<Expected>, ExportError> {
        let file = self.load()?;
        let doc = doc.to_string();
        Ok(file
            .entries
            .into_iter()
            .find(|e| e.doc == doc && e.repository == repository)
            .map(|e| e.expected))
    }

    /// Replace the entry for `doc` in `repository`.
    pub fn store(
        &self,
        doc: DocId,
        repository: &str,
        expected: Expected,
    ) -> Result<(), ExportError> {
        let mut file = self.load()?;
        let doc = doc.to_string();
        file.entries
            .retain(|e| !(e.doc == doc && e.repository == repository));
        file.entries.push(Entry {
            doc,
            repository: repository.to_owned(),
            expected,
        });
        file.version = VERSION;
        self.save(&file)
    }

    fn load(&self) -> Result<StateFile, ExportError> {
        let raw = match std::fs::read(&self.path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(StateFile {
                    version: VERSION,
                    entries: Vec::new(),
                })
            }
            Err(e) => return Err(io("unreadable", e)),
        };
        let file: StateFile = serde_json::from_slice(&raw).map_err(|e| bad("is corrupt", e))?;
        if file.version != VERSION {
            return Err(bad("has an unknown version", file.version));
        }
        Ok(file)
    }

    /// Through the shared atomic replacement: a fresh temp file (`0600`
    /// on Unix) beside the target, synced, renamed, the directory synced.
    fn save(&self, file: &StateFile) -> Result<(), ExportError> {
        let bytes = serde_json::to_vec_pretty(file).map_err(|e| bad("unserializable", e))?;
        let dir = self.path.parent().unwrap_or(Path::new("."));
        crate::atomic_replace::atomic_replace(&self.path, dir, &bytes)
            .map_err(|e| io("not saved", format!("{e:?}")))
    }
}

#[cfg(test)]
#[path = "state.test.rs"]
mod tests;
