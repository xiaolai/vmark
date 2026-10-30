//! Store and automation-bridge grants (`app_plugins.rs`).
//!
//! Two permissions used to reach further than their callers needed:
//! `store:default` carried `store:allow-load`, whose path argument the store
//! plugin joins onto app data, so an absolute path let webview JS write a JSON
//! object to any file the user can write; and `automation-bridge.json` sat in
//! `capabilities/`, which tauri-build compiles into release builds too. These
//! tests read the shipped files and pin the narrower shape.

use serde_json::Value;
use std::path::Path;

fn static_capabilities() -> Vec<(String, Value)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("capabilities/ exists") {
        let path = entry.expect("readable entry").path();
        if path.extension().is_some_and(|e| e == "json") {
            let raw = std::fs::read_to_string(&path).expect("readable capability");
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            out.push((name, serde_json::from_str(&raw).expect("valid JSON")));
        }
    }
    assert!(!out.is_empty(), "no capability files found in {dir:?}");
    out
}

fn permission_ids(capability: &Value) -> Vec<String> {
    capability["permissions"]
        .as_array()
        .expect("capability declares permissions")
        .iter()
        .filter_map(|p| p.as_str().or_else(|| p["identifier"].as_str()))
        .map(str::to_owned)
        .collect()
}

#[test]
fn no_window_may_load_a_store_by_path() {
    for (name, capability) in static_capabilities() {
        for id in permission_ids(&capability) {
            assert!(
                id != "store:default" && id != "store:allow-load",
                "{name} grants {id}: `load` takes a path an absolute value carries \
                 outside app data; the backend opens the one store the webview uses"
            );
        }
    }
}

#[test]
fn the_windows_that_persist_ai_config_can_reach_the_opened_store() {
    // secureStorage.ts runs in document windows and in Settings.
    let needed = [
        "store:allow-get-store",
        "store:allow-get",
        "store:allow-set",
        "store:allow-delete",
        "store:allow-save",
    ];
    for (name, capability) in static_capabilities() {
        if name != "default.json" && name != "settings.json" {
            continue;
        }
        let ids = permission_ids(&capability);
        for id in needed {
            assert!(ids.iter().any(|g| g == id), "{name} lacks {id}");
        }
    }
}

#[test]
fn no_static_capability_grants_the_automation_bridge() {
    for (name, capability) in static_capabilities() {
        for id in permission_ids(&capability) {
            assert!(
                !id.starts_with("mcp-bridge:"),
                "{name} grants {id} in every build; the debug bridge adds its own \
                 capability at runtime"
            );
        }
    }
}

#[test]
fn the_runtime_automation_capability_covers_document_windows() {
    let capability: tauri::utils::acl::capability::Capability =
        serde_json::from_str(super::AUTOMATION_BRIDGE_CAPABILITY)
            .expect("the runtime capability parses as a Tauri capability");
    assert_eq!(capability.identifier, "automation-bridge");
    assert_eq!(capability.windows, ["main", "doc-*"]);
    let ids: Vec<String> = capability
        .permissions
        .iter()
        .map(|p| p.identifier().get().to_owned())
        .collect();
    assert_eq!(ids, ["mcp-bridge:default"]);
}

// `tauri::test` does not exist on Windows (AGENTS.md).
#[cfg(not(target_os = "windows"))]
#[test]
fn the_secure_store_is_open_before_any_window_asks_for_it() {
    use tauri_plugin_store::StoreExt;
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(super::secure_store_opener())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds");
    assert!(
        app.get_store(super::SECURE_STORE_PATH).is_some(),
        "the webview's getStore lookup would find nothing and fall back to localStorage"
    );
}
