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
            window.workspace_instances =
                synthesize_workspace_instances(&window.window_label, &window.tabs, legacy_root.as_deref());
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
}

fn synthesize_workspace_instances(
    window_label: &str,
    tabs: &[TabState],
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
                active_tab_id: None,
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
            active_tab_id: None,
            tab_ids: loose_tab_ids,
            closed_tab_ids: Vec::new(),
            unavailable_root: false,
        });
    }
    instances
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

fn is_within_root(root: &str, path: &str) -> bool {
    path == root || path.starts_with(&format!("{root}/"))
}

fn display_name_for_path(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(path)
        .to_string()
}
