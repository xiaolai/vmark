//! Context commands (WI-2b.7; design-2a.md D1). Service tier (ADR-C4):
//! list the context set (implicit default always present), create named
//! greenhouse contexts, and flip enforcement — the explicit human
//! confirmation for enforcing lives in the UI (D4.3); this layer only
//! records the already-confirmed choice. Manifests are current state,
//! not history (spec §6).

use serde::Serialize;
use uuid::Uuid;

use super::contexts::{
    write_manifest, ContextManifest, ContextSet, Enforcement, DEFAULT_CONTEXT_ID,
};
use super::state::WorkspaceKernel;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRow {
    pub id: Uuid,
    pub name: String,
    pub parent: Option<Uuid>,
    pub enforcement: String,
    pub visible_claims: usize,
    /// Per-file load errors and structural chain errors, surfaced.
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReceipt {
    pub id: Uuid,
}

fn contexts_dir(kernel: &WorkspaceKernel) -> std::path::PathBuf {
    kernel.root().join(".vmark").join("contexts")
}

fn enforcement_str(e: Enforcement) -> &'static str {
    match e {
        Enforcement::Enforcing => "enforcing",
        Enforcement::Greenhouse => "greenhouse",
    }
}

pub fn perform_contexts_list(kernel: &mut WorkspaceKernel) -> Result<Vec<ContextRow>, String> {
    let set = ContextSet::load(&contexts_dir(kernel));
    let mut rows = Vec::new();
    // The implicit default first — it exists with or without a manifest.
    rows.push(ContextRow {
        id: DEFAULT_CONTEXT_ID,
        name: "default".into(),
        parent: None,
        enforcement: "greenhouse".into(),
        visible_claims: set.effective_claims(DEFAULT_CONTEXT_ID).len(),
        errors: Vec::new(),
    });
    let mut named: Vec<&ContextManifest> = set
        .manifests
        .values()
        .filter(|m| m.id != DEFAULT_CONTEXT_ID)
        .collect();
    named.sort_by(|a, b| a.name.cmp(&b.name));
    for m in named {
        let (_, chain_errors) = set.effective_view(m.id);
        let mut errors: Vec<String> = chain_errors.into_iter().map(|e| e.reason).collect();
        errors.extend(
            set.errors
                .iter()
                .filter(|e| e.context == m.name)
                .map(|e| e.reason.clone()),
        );
        rows.push(ContextRow {
            id: m.id,
            name: m.name.clone(),
            parent: m.parent,
            enforcement: enforcement_str(m.enforcement).into(),
            visible_claims: set.effective_claims(m.id).len(),
            errors,
        });
    }
    Ok(rows)
}

pub fn perform_context_create(
    kernel: &mut WorkspaceKernel,
    name: &str,
    parent: Option<Uuid>,
) -> Result<ContextReceipt, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("a context needs a non-empty name".into());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err("context names use letters, digits, '-' and '_' only".into());
    }
    kernel.ensure_initialized()?;
    let dir = contexts_dir(kernel);
    let set = ContextSet::load(&dir);
    if set.manifests.values().any(|m| m.name == name) {
        return Err(format!("a context named {name:?} already exists"));
    }
    if let Some(p) = parent {
        if p != DEFAULT_CONTEXT_ID && !set.manifests.contains_key(&p) {
            return Err(format!("unknown parent context: {p}"));
        }
    }
    let manifest = ContextManifest {
        format: 0,
        id: Uuid::now_v7(),
        name: name.to_string(),
        parent,
        selections: Default::default(),
        enforcement: Enforcement::Greenhouse, // D1.4: always opt-in later
        visible_claims: Vec::new(),
    };
    write_manifest(&dir, &manifest)?;
    Ok(ContextReceipt { id: manifest.id })
}

pub fn perform_context_enforce(
    kernel: &mut WorkspaceKernel,
    context: Uuid,
    enforcing: bool,
) -> Result<(), String> {
    if context == DEFAULT_CONTEXT_ID {
        return Err(
            "the implicit default context stays greenhouse — create a named context to enforce"
                .into(),
        );
    }
    let dir = contexts_dir(kernel);
    let set = ContextSet::load(&dir);
    let Some(m) = set.manifests.get(&context) else {
        return Err(format!("unknown context: {context}"));
    };
    let mut m = m.clone();
    m.enforcement = if enforcing {
        Enforcement::Enforcing
    } else {
        Enforcement::Greenhouse
    };
    write_manifest(&dir, &m)
}

#[tauri::command]
pub async fn coherence_contexts(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
) -> Result<Vec<ContextRow>, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_contexts_list(&mut kernel)
}

#[tauri::command]
pub async fn coherence_context_create(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    name: String,
    parent: Option<Uuid>,
) -> Result<ContextReceipt, String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_context_create(&mut kernel, &name, parent)
}

#[tauri::command]
pub async fn coherence_context_enforce(
    state: tauri::State<'_, super::commands::CoherenceState>,
    workspace_root: String,
    context: Uuid,
    enforcing: bool,
) -> Result<(), String> {
    let kernel = state
        .registry
        .kernel_for(std::path::Path::new(&workspace_root), state.writer)?;
    let mut kernel = kernel.lock().map_err(|_| "kernel poisoned".to_string())?;
    perform_context_enforce(&mut kernel, context, enforcing)
}

#[cfg(test)]
#[path = "context_commands.test.rs"]
mod tests;
