use super::super::session::{SessionData, TabState, WorkspaceInstanceState};

/// Migrate v4 -> v5: Add explicit workspace context kind.
pub(super) fn migrate_v4_to_v5(mut session: SessionData) -> Result<SessionData, String> {
    let legacy_root = session
        .workspace
        .as_ref()
        .filter(|workspace| workspace.is_workspace_mode)
        .and_then(|workspace| workspace.root_path.clone());

    for window in &mut session.windows {
        if window.workspace_instances.is_empty() {
            window.workspace_instances = synthesize_workspace_instances(
                &window.window_label,
                &window.tabs,
                window.active_tab_id.as_deref(),
                legacy_root.as_deref(),
            );
        } else {
            for instance in &mut window.workspace_instances {
                normalize_workspace_instance(instance);
                instance.owner_window_label = window.window_label.clone();
            }
        }

        let ids = ordered_valid_ids(&window.workspace_instance_ids, &window.workspace_instances);
        window.workspace_instance_ids = ids.clone();
        window.active_workspace_instance_id = choose_active_instance_id(
            window.active_workspace_instance_id.as_deref(),
            window.active_tab_id.as_deref(),
            &window.workspace_instances,
            &ids,
        );
    }

    session.version = 5;
    Ok(session)
}

fn normalize_workspace_instance(instance: &mut WorkspaceInstanceState) {
    if instance.kind.is_empty() {
        instance.kind = if instance.root_path.is_some() {
            "workspace".to_string()
        } else if instance.created_from == "placeholder" && instance.tab_ids.is_empty() {
            "placeholder".to_string()
        } else {
            "loose".to_string()
        };
    }
    if instance.kind == "loose" {
        instance.root_id = None;
        instance.root_path = None;
        instance.display_name = "Loose Files".to_string();
    }
    if instance.kind == "placeholder" {
        instance.root_id = None;
        instance.root_path = None;
    }
    // Deduplicate tab references to match the TypeScript migration's
    // `uniqueStrings` behavior — otherwise Rust startup restore could preserve
    // duplicate tab references that the TS path would have collapsed.
    instance.tab_ids = unique_strings(&instance.tab_ids);
    instance.closed_tab_ids = unique_strings(&instance.closed_tab_ids);
}

/// Deduplicate a list of ids preserving first-seen order (mirrors the
/// TypeScript migration's `uniqueStrings`).
fn unique_strings(values: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values
        .iter()
        .filter(|value| seen.insert((*value).clone()))
        .cloned()
        .collect()
}

fn synthesize_workspace_instances(
    window_label: &str,
    tabs: &[TabState],
    active_tab_id: Option<&str>,
    legacy_root: Option<&str>,
) -> Vec<WorkspaceInstanceState> {
    if tabs.is_empty() {
        return Vec::new();
    }

    let mut workspace_tab_ids = Vec::new();
    let mut loose_tab_ids = Vec::new();
    for tab in tabs {
        if let (Some(root), Some(path)) = (legacy_root, tab.file_path.as_deref()) {
            if is_within_root(root, path) {
                workspace_tab_ids.push(tab.id.clone());
                continue;
            }
        }
        loose_tab_ids.push(tab.id.clone());
    }

    let mut instances = Vec::new();
    if let Some(root) = legacy_root {
        if !workspace_tab_ids.is_empty() {
            instances.push(WorkspaceInstanceState {
                workspace_instance_id: format!("wsi-legacy-{window_label}-workspace"),
                kind: "workspace".to_string(),
                root_id: Some(format!("path:macos:{root}")),
                root_path: Some(root.to_string()),
                display_name: display_name_for_path(root),
                owner_window_label: window_label.to_string(),
                created_from: "restore".to_string(),
                // Preserve the active tab when it belongs to this synthesized
                // context — matches the TypeScript migration's `activeTabInList`.
                active_tab_id: active_tab_in_list(active_tab_id, &workspace_tab_ids),
                tab_ids: workspace_tab_ids,
                closed_tab_ids: Vec::new(),
                unavailable_root: false,
            });
        }
    }
    if !loose_tab_ids.is_empty() {
        instances.push(WorkspaceInstanceState {
            workspace_instance_id: format!("wsi-legacy-{window_label}-loose"),
            kind: "loose".to_string(),
            root_id: None,
            root_path: None,
            display_name: "Loose Files".to_string(),
            owner_window_label: window_label.to_string(),
            created_from: "restore".to_string(),
            active_tab_id: active_tab_in_list(active_tab_id, &loose_tab_ids),
            tab_ids: loose_tab_ids,
            closed_tab_ids: Vec::new(),
            unavailable_root: false,
        });
    }
    instances
}

/// Return `active_tab_id` only when it appears in `tab_ids`, else `None`.
/// Mirrors the TypeScript migration's `activeTabInList`.
fn active_tab_in_list(active_tab_id: Option<&str>, tab_ids: &[String]) -> Option<String> {
    let active = active_tab_id?;
    if tab_ids.iter().any(|id| id == active) {
        Some(active.to_string())
    } else {
        None
    }
}

fn ordered_valid_ids(
    raw_ids: &[String],
    instances: &[WorkspaceInstanceState],
) -> Vec<String> {
    let mut ids: Vec<String> = raw_ids
        .iter()
        .filter(|id| instances.iter().any(|instance| &instance.workspace_instance_id == *id))
        .cloned()
        .collect();
    for instance in instances {
        if !ids.contains(&instance.workspace_instance_id) {
            ids.push(instance.workspace_instance_id.clone());
        }
    }
    ids
}

fn choose_active_instance_id(
    raw_active_id: Option<&str>,
    active_tab_id: Option<&str>,
    instances: &[WorkspaceInstanceState],
    ids: &[String],
) -> Option<String> {
    if let Some(active_id) = raw_active_id {
        if ids.iter().any(|id| id == active_id) {
            return Some(active_id.to_string());
        }
    }
    if let Some(tab_id) = active_tab_id {
        if let Some(instance) = instances.iter().find(|instance| {
            instance.tab_ids.iter().any(|candidate| candidate == tab_id)
        }) {
            return Some(instance.workspace_instance_id.clone());
        }
    }
    ids.iter()
        .find(|id| {
            instances
                .iter()
                .find(|instance| &instance.workspace_instance_id == *id)
                .map(|instance| instance.kind != "placeholder")
                .unwrap_or(false)
        })
        .cloned()
        .or_else(|| ids.first().cloned())
}

/// Normalize a path for boundary comparison, mirroring the behavior of
/// `src/utils/paths`' `normalizePath`:
///   - convert backslashes to forward slashes (Windows paths)
///   - lowercase a leading Windows drive letter (e.g. `C:/` -> `c:/`)
///   - collapse duplicate separators
///   - strip trailing slashes (but keep the root `/`)
fn normalize_path(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }

    let mut normalized: String = path.replace('\\', "/");

    // Lowercase a leading Windows drive letter ("C:/..." -> "c:/...").
    if normalized.len() >= 2 {
        let bytes = normalized.as_bytes();
        if bytes[0].is_ascii_uppercase() && bytes[1] == b':' {
            normalized = format!("{}{}", (bytes[0] as char).to_ascii_lowercase(), &normalized[1..]);
        }
    }

    // Collapse duplicate separators (e.g. "/a//b" -> "/a/b").
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }

    // Remove trailing slashes (but not the root slash).
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }

    normalized
}

/// Check whether `path` is within (or equal to) `root` using normalized,
/// separator-aware boundary checks — not raw string prefixes. This keeps the
/// Rust migration aligned with `src/utils/paths`' `isWithinRoot` so Windows
/// paths, duplicate separators, and trailing-slash variants are classified the
/// same way on both sides of the dual migration contract.
pub(super) fn is_within_root(root: &str, path: &str) -> bool {
    let normalized_root = normalize_path(root);
    let normalized_path = normalize_path(path);
    if normalized_path == normalized_root {
        return true;
    }
    // The child boundary is the root followed by a separator. When the root is
    // the filesystem root ("/"), it already ends in a separator, so appending
    // another would produce "//" and match nothing — every absolute path is a
    // child of "/".
    let boundary = if normalized_root.ends_with('/') {
        normalized_root.clone()
    } else {
        format!("{normalized_root}/")
    };
    normalized_path.starts_with(&boundary)
}

fn display_name_for_path(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_string()
}
