//! The five window-status commands and `prune`, driven on a mock runtime.
//!
//! The reducers are pinned in `mod.rs`; these pin what the commands add on top:
//! the CALLING window's label is the key (never an argument), every change is
//! broadcast once and an unchanged attention flag is not, and `focus_window`
//! refuses an unknown label with a typed `not-found`.

// `tauri::test` does not exist on Windows (AGENTS.md).
#![cfg(not(target_os = "windows"))]

use super::{
    clear_window_attention, focus_window, get_window_statuses, prune, report_window_status,
    set_window_attention, WindowStatus, WindowStatusRegistry, EVENT,
};
use crate::command_error::ErrorCode;
use std::sync::{Arc, Mutex};
use tauri::test::MockRuntime;
use tauri::{Listener, Manager, WebviewUrl, WebviewWindowBuilder};

type Broadcasts = Arc<Mutex<Vec<Vec<WindowStatus>>>>;

fn mock_app() -> (tauri::App<MockRuntime>, Broadcasts) {
    let app = tauri::test::mock_builder()
        .manage(WindowStatusRegistry::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds");
    let seen: Broadcasts = Arc::default();
    let sink = seen.clone();
    app.listen_any(EVENT, move |event| {
        let snapshot: Vec<WindowStatus> =
            serde_json::from_str(event.payload()).expect("snapshot payload");
        sink.lock().unwrap().push(snapshot);
    });
    (app, seen)
}

fn window(app: &tauri::App<MockRuntime>, label: &str) -> tauri::Window<MockRuntime> {
    let webview = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .build()
        .expect("mock window builds");
    webview.as_ref().window()
}

fn count(seen: &Broadcasts) -> usize {
    seen.lock().unwrap().len()
}

#[test]
fn a_report_is_keyed_by_the_calling_window_and_broadcast() {
    let (app, seen) = mock_app();
    let doc = window(&app, "doc-2");
    report_window_status(doc, "notes.md".into(), "running".into(), 7);

    let list = get_window_statuses(app.handle().clone());
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].label, "doc-2");
    assert_eq!(list[0].doc_name, "notes.md");
    assert_eq!(list[0].ai, "running");
    assert_eq!(list[0].elapsed_seconds, 7);
    assert_eq!(seen.lock().unwrap().last().cloned(), Some(list));
}

#[test]
fn attention_is_broadcast_only_when_it_changes() {
    let (app, seen) = mock_app();
    let doc = window(&app, "doc-1");
    set_window_attention(doc.clone());
    set_window_attention(doc.clone());
    assert_eq!(count(&seen), 1, "a repeat bell must not re-broadcast");
    assert!(get_window_statuses(app.handle().clone())[0].attention);

    clear_window_attention(doc.clone());
    clear_window_attention(doc);
    assert_eq!(count(&seen), 2, "a repeat clear must not re-broadcast");
    assert!(!get_window_statuses(app.handle().clone())[0].attention);
}

#[test]
fn clearing_a_window_never_seen_adds_no_row_and_says_nothing() {
    let (app, seen) = mock_app();
    clear_window_attention(window(&app, "doc-9"));
    assert!(get_window_statuses(app.handle().clone()).is_empty());
    assert_eq!(count(&seen), 0);
}

#[test]
fn the_snapshot_is_sorted_by_label() {
    let (app, _) = mock_app();
    report_window_status(window(&app, "doc-3"), "c".into(), "idle".into(), 0);
    report_window_status(window(&app, "doc-1"), "a".into(), "idle".into(), 0);
    let labels: Vec<String> = get_window_statuses(app.handle().clone())
        .into_iter()
        .map(|s| s.label)
        .collect();
    assert_eq!(labels, ["doc-1", "doc-3"]);
}

#[test]
fn prune_drops_the_row_and_broadcasts_the_shorter_list() {
    let (app, seen) = mock_app();
    report_window_status(window(&app, "doc-1"), "a".into(), "idle".into(), 0);
    report_window_status(window(&app, "doc-2"), "b".into(), "idle".into(), 0);
    prune(app.handle(), "doc-1");
    let list = get_window_statuses(app.handle().clone());
    assert_eq!(
        list.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(),
        ["doc-2"]
    );
    assert_eq!(seen.lock().unwrap().last().cloned(), Some(list));
}

#[test]
fn focus_window_refuses_an_unknown_label_as_not_found() {
    let (app, _) = mock_app();
    let err = focus_window(app.handle().clone(), "doc-404".into()).expect_err("no such window");
    assert_eq!(err.code(), ErrorCode::NotFound);
    assert!(err.message().contains("doc-404"), "{}", err.message());
}

#[test]
fn focus_window_focuses_an_open_window() {
    let (app, _) = mock_app();
    let _doc = window(&app, "doc-1");
    assert!(app.get_webview_window("doc-1").is_some());
    focus_window(app.handle().clone(), "doc-1".into()).expect("an open window can be focused");
}
