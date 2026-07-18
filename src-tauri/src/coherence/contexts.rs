//! Context manifests (WI-2b.1; spec §6 revision 1, design-2a.md D1).
//! Pure (ADR-C4 kernel tier): loads `.vmark/contexts/*.json`, validates
//! the single-inheritance chain, and materializes the Phase 1
//! `ContextView` — `effective_selection` is the overlay walk feeding
//! `dag::resolve`, not a reimplementation. Fail loud: structural errors
//! (cycle, overflow, unknown id) degrade to the implicit default context
//! and are surfaced, never guessed around.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::dag::ContextView;
use super::types::{ObjectId, RevisionId};

/// The implicit default context's fixed id (spec §5.4.4 revision 1) —
/// all-live, greenhouse, no claims, no manifest file.
pub const DEFAULT_CONTEXT_ID: Uuid = Uuid::nil();

/// D1.1: a parent chain must terminate within this many hops.
const MAX_CHAIN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Enforcement {
    Enforcing,
    #[default]
    Greenhouse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextManifest {
    pub format: u32,
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub parent: Option<Uuid>,
    /// object-uuid → `"live"` or `"rev1:…"` (spec §6).
    #[serde(default)]
    pub selections: HashMap<Uuid, String>,
    /// D1.4: never inherited; missing means greenhouse.
    #[serde(default)]
    pub enforcement: Enforcement,
    #[serde(default)]
    pub visible_claims: Vec<Uuid>,
    /// D3.1 (spec §6 rev 2): opt-in exact-match branch mapping. Never
    /// selects a context automatically — it only surfaces a pull-only
    /// candidate in the UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    /// Round-trip guarantee (design-3.md, spec rev 2): fields this build
    /// does not understand survive a rewrite instead of being dropped —
    /// manifests are mutable-in-place, so a lossy writer would destroy a
    /// newer build's additive fields (e.g. `git_branch`).
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextError {
    /// The context the error is about (file stem or manifest id).
    pub context: String,
    pub reason: String,
}

#[derive(Debug, Default)]
pub struct ContextSet {
    pub manifests: HashMap<Uuid, ContextManifest>,
    /// Per-file load errors (parse failures, duplicate ids). Structural
    /// chain errors are reported per query by `effective_view`.
    pub errors: Vec<ContextError>,
}

impl ContextSet {
    /// Load every `*.json` manifest. A missing directory is an empty set
    /// (only the implicit default exists). Unreadable or malformed files
    /// become errors, never panics — one bad manifest must not take the
    /// rest down.
    pub fn load(dir: &Path) -> Self {
        let mut set = ContextSet::default();
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return set,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|x| x != "json") {
                continue;
            }
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) => {
                    set.errors.push(ContextError {
                        context: stem,
                        reason: format!("manifest unreadable: {e}"),
                    });
                    continue;
                }
            };
            match serde_json::from_str::<ContextManifest>(&text) {
                Ok(m) => {
                    if set.manifests.contains_key(&m.id) {
                        set.errors.push(ContextError {
                            context: stem,
                            reason: format!("duplicate context id {}", m.id),
                        });
                        continue;
                    }
                    set.manifests.insert(m.id, m);
                }
                Err(e) => set.errors.push(ContextError {
                    context: stem,
                    reason: format!("manifest parse failed: {e}"),
                }),
            }
        }
        set
    }

    /// The child→parent chain for `id`, or a structural error (unknown
    /// id, cycle, overflow). The default context has an empty chain.
    fn chain(&self, id: Uuid) -> Result<Vec<&ContextManifest>, ContextError> {
        // The implicit default exists without a manifest; a materialized
        // `default.json` (spec §6) joins the walk like any other context.
        if id == DEFAULT_CONTEXT_ID && !self.manifests.contains_key(&id) {
            return Ok(Vec::new());
        }
        let mut chain = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut cursor = Some(id);
        while let Some(cid) = cursor {
            if !seen.insert(cid) {
                return Err(ContextError {
                    context: id.to_string(),
                    reason: format!("context chain cycle at {cid}"),
                });
            }
            if chain.len() >= MAX_CHAIN {
                return Err(ContextError {
                    context: id.to_string(),
                    reason: format!("context chain exceeds {MAX_CHAIN} hops"),
                });
            }
            let Some(m) = self.manifests.get(&cid) else {
                return Err(ContextError {
                    context: id.to_string(),
                    reason: format!("unknown context id {cid}"),
                });
            };
            chain.push(m);
            cursor = m.parent;
        }
        Ok(chain)
    }

    /// Materialize the effective `ContextView` (D1.2): walk child →
    /// parent, first explicit selection wins, absent everywhere → live.
    /// Structural errors degrade to the implicit default (all-live) and
    /// are returned for surfacing; invalid selection values are surfaced
    /// per entry and treated as live (the entry, not the context, fails).
    pub fn effective_view(&self, id: Uuid) -> (ContextView, Vec<ContextError>) {
        let chain = match self.chain(id) {
            Ok(c) => c,
            Err(e) => return (ContextView::all_live(), vec![e]),
        };
        let mut view = ContextView::all_live();
        let mut errors = Vec::new();
        let mut decided = std::collections::HashSet::new();
        for m in &chain {
            for (obj, sel) in &m.selections {
                if !decided.insert(*obj) {
                    continue; // a nearer (child) level already decided
                }
                match sel.as_str() {
                    "live" => {}
                    s => match RevisionId::parse(s) {
                        Ok(rev) => view.pin(ObjectId(*obj), rev),
                        Err(e) => errors.push(ContextError {
                            context: m.name.clone(),
                            reason: format!("invalid selection for {obj}: {e}"),
                        }),
                    },
                }
            }
        }
        (view, errors)
    }

    /// D1.3: additive union along the chain, deduped by claim id —
    /// child-first order, a child can never hide a parent's claim.
    pub fn effective_claims(&self, id: Uuid) -> Vec<Uuid> {
        let Ok(chain) = self.chain(id) else {
            return Vec::new();
        };
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for m in chain {
            for claim in &m.visible_claims {
                if seen.insert(*claim) {
                    out.push(*claim);
                }
            }
        }
        out
    }
}

/// Atomic manifest write (spec §6: temp + rename — manifests are the
/// only mutable-in-place files under `.vmark/`).
pub fn write_manifest(dir: &Path, m: &ContextManifest) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("contexts dir: {e}"))?;
    let final_path = dir.join(format!("{}.json", m.name));
    let tmp = dir.join(format!(".{}.tmp", m.name));
    let json = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| format!("manifest temp write: {e}"))?;
    std::fs::rename(&tmp, &final_path).map_err(|e| format!("manifest rename: {e}"))?;
    Ok(())
}

#[cfg(test)]
#[path = "contexts.test.rs"]
mod tests;
