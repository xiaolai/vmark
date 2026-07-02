//! Tests for the workflow runner (extracted from runner.rs to keep the
//! production file within the size gate).

use super::*;

#[test]
fn test_topological_sort_sequential() {
    let steps = vec![
        RawStep {
            id: Some("a".into()),
            uses: "action/read-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("b".into()),
            uses: "genie/summarize".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("a".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
    ];
    let sorted = topological_sort(steps).unwrap();
    assert_eq!(sorted[0].id, "a");
    assert_eq!(sorted[1].id, "b");
}

#[test]
fn test_topological_sort_fan_out() {
    let steps = vec![
        RawStep {
            id: Some("read".into()),
            uses: "action/read-folder".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("sum".into()),
            uses: "genie/summarize".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("read".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("translate".into()),
            uses: "genie/translate".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("read".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("save".into()),
            uses: "action/save-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::List(vec!["sum".into(), "translate".into()]),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
    ];
    let sorted = topological_sort(steps).unwrap();
    // "read" must come first, "save" must come last
    assert_eq!(sorted[0].id, "read");
    assert_eq!(sorted[3].id, "save");
    // "sum" and "translate" are in between (order among them doesn't matter)
    let middle: HashSet<&str> = [sorted[1].id.as_str(), sorted[2].id.as_str()].into();
    assert!(middle.contains("sum"));
    assert!(middle.contains("translate"));
}

#[test]
fn test_topological_sort_circular() {
    let steps = vec![
        RawStep {
            id: Some("a".into()),
            uses: "action/read-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("b".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("b".into()),
            uses: "genie/summarize".into(),
            with: HashMap::new(),
            needs: NeedsDef::Single("a".into()),
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
    ];
    let result = topological_sort(steps);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Circular"));
}

#[test]
fn test_topological_sort_missing_dep() {
    let steps = vec![RawStep {
        id: Some("a".into()),
        uses: "action/read-file".into(),
        with: HashMap::new(),
        needs: NeedsDef::Single("nonexistent".into()),
        condition: None,
        model: None,
        approval: None,
        limits: None,
    }];
    let result = topological_sort(steps);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unknown step"));
}

#[test]
fn test_truncate_utf8_safe_ascii() {
    let s = "hello world";
    assert_eq!(truncate_utf8_safe(s, 100), s);
}

#[test]
fn test_truncate_utf8_safe_cjk() {
    let s = "你好世界测试数据";
    // Each CJK char is 3 bytes. 8 chars = 24 bytes.
    let result = truncate_utf8_safe(s, 10);
    // Should truncate at char boundary, not panic
    assert!(result.contains("..."));
    assert!(!result.is_empty());
}

#[tokio::test]
async fn test_execute_action_notify() {
    let mut params = HashMap::new();
    params.insert("message".to_string(), "Hello".to_string());
    let root = std::path::Path::new("/tmp");
    let result = execute_action("action/notify", &params, root).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "Hello");
}

#[tokio::test]
async fn test_execute_action_copy() {
    let mut params = HashMap::new();
    params.insert("input".to_string(), "test data".to_string());
    let root = std::path::Path::new("/tmp");
    let result = execute_action("action/copy", &params, root).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "test data");
}

#[tokio::test]
async fn test_execute_action_unknown() {
    let params = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let result = execute_action("action/unknown", &params, root).await;
    assert!(result.is_err());
}

fn step_with_uses(uses: &str) -> RawStep {
    RawStep {
        id: Some("s".into()),
        uses: uses.into(),
        with: HashMap::new(),
        needs: NeedsDef::None,
        condition: None,
        model: None,
        approval: None,
        limits: None,
    }
}

#[tokio::test]
async fn test_execute_step_unknown_type() {
    let params = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let defaults = RawDefaults::default();
    let result = execute_step(
        &step_with_uses("unknown/thing"),
        &params,
        root,
        CancellationToken::new(),
        None,
        None,
        &defaults,
    )
    .await;
    assert!(result.is_err());
}

// Per-step timeout enforcement (WI-2.5): see cli::tests::cancellation_kills_long_running_shim
// for the cancellation primitive proof. The runner wraps each step
// exec in tokio::time::timeout(step_config.timeout_secs, ...) and fires
// the shared CancellationToken on elapsed; both layers are exercised
// separately by the ai_provider tests and the standard tokio test suite.

#[tokio::test]
async fn test_genie_step_without_provider_returns_error() {
    // Without an active provider configured, a genie step fails fast
    // with a clear message rather than panicking.
    let params = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let defaults = RawDefaults::default();
    let result = execute_step(
        &step_with_uses("genie/summarize"),
        &params,
        root,
        CancellationToken::new(),
        None,
        None,
        &defaults,
    )
    .await;
    assert!(matches!(result, Err(ref e) if e.contains("provider")));
}

#[tokio::test]
async fn test_webhook_step_returns_error() {
    let params = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let defaults = RawDefaults::default();
    let result = execute_step(
        &step_with_uses("webhook/stripe"),
        &params,
        root,
        CancellationToken::new(),
        None,
        None,
        &defaults,
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_prompt_returns_error() {
    let params = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let result = execute_action("action/prompt", &params, root).await;
    assert!(result.is_err());
}

#[test]
fn test_matches_accept() {
    assert!(matches_accept("readme.md", "*"));
    assert!(matches_accept("readme.md", "*.md"));
    assert!(matches_accept("readme.md", ".md"));
    assert!(!matches_accept("readme.md", "*.txt"));
}

#[test]
fn test_env_substitution_via_resolver() {
    // Legacy ${VAR} syntax still works via the new expression resolver.
    let env: HashMap<String, String> = [("DIR".to_string(), "notes".to_string())].into();
    let outputs = WorkflowOutputs::new();
    let result = expressions::resolve("output/${DIR}/file.md", &outputs, &env).unwrap();
    assert_eq!(result, "output/notes/file.md");
}

#[test]
fn test_env_substitution_multiple_vars_via_resolver() {
    let env: HashMap<String, String> = [
        ("A".to_string(), "hello".to_string()),
        ("B".to_string(), "world".to_string()),
    ]
    .into();
    let outputs = WorkflowOutputs::new();
    let result = expressions::resolve("${A}/${B}", &outputs, &env).unwrap();
    assert_eq!(result, "hello/world");
}

#[test]
fn test_resolve_params_output_ref_missing() {
    let mut params = HashMap::new();
    params.insert("input".to_string(), "missing.output".to_string());
    let outputs = WorkflowOutputs::new();
    let env = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let result = resolve_params(&params, &outputs, &env, root);
    assert!(result.is_err());
}

#[test]
fn test_resolve_params_steps_outputs_field() {
    // WI-2.3: ${{ steps.X.outputs.Y }} resolves to outputs[X][Y].
    let mut params = HashMap::new();
    params.insert(
        "input".to_string(),
        "${{ steps.outline.outputs.text }}".to_string(),
    );
    let mut outputs = WorkflowOutputs::new();
    outputs.insert(
        "outline".to_string(),
        HashMap::from([("text".to_string(), "section list".to_string())]),
    );
    let env = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let resolved = resolve_params(&params, &outputs, &env, root).unwrap();
    assert_eq!(resolved.get("input").unwrap(), "section list");
}

#[test]
fn test_resolve_params_bare_alias_still_works() {
    // Backward compat: stepId.output reads outputs[id]["text"].
    let mut params = HashMap::new();
    params.insert("input".to_string(), "outline.output".to_string());
    let mut outputs = WorkflowOutputs::new();
    outputs.insert(
        "outline".to_string(),
        HashMap::from([("text".to_string(), "compat ok".to_string())]),
    );
    let env = HashMap::new();
    let root = std::path::Path::new("/tmp");
    let resolved = resolve_params(&params, &outputs, &env, root).unwrap();
    assert_eq!(resolved.get("input").unwrap(), "compat ok");
}

// -- audit g3-rust-rest regression tests --------------------------------------

#[test]
fn test_topological_sort_rejects_duplicate_ids() {
    let steps = vec![
        RawStep {
            id: Some("dup".into()),
            uses: "action/read-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: Some("dup".into()),
            uses: "action/save-file".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
    ];
    let result = topological_sort(steps);
    assert!(
        result.is_err(),
        "duplicate ids must not be silently dropped"
    );
    assert!(result.unwrap_err().contains("dup"));
}

#[test]
fn test_topological_sort_rejects_duplicate_derived_ids() {
    // Two id-less steps using the same action derive the same id.
    let steps = vec![
        RawStep {
            id: None,
            uses: "action/notify".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
        RawStep {
            id: None,
            uses: "action/notify".into(),
            with: HashMap::new(),
            needs: NeedsDef::None,
            condition: None,
            model: None,
            approval: None,
            limits: None,
        },
    ];
    assert!(topological_sort(steps).is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn test_read_folder_skips_symlink_escaping_workspace() {
    let ws = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("secret.md");
    std::fs::write(&secret, "TOP-SECRET").unwrap();
    std::fs::write(ws.path().join("inside.md"), "INSIDE-OK").unwrap();
    std::os::unix::fs::symlink(&secret, ws.path().join("leak.md")).unwrap();

    let mut params = HashMap::new();
    params.insert("path".to_string(), ".".to_string());
    let output = execute_action("action/read-folder", &params, ws.path())
        .await
        .unwrap();
    assert!(output.contains("INSIDE-OK"));
    assert!(
        !output.contains("TOP-SECRET"),
        "symlink escaping the workspace must not be read"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn test_read_folder_allows_symlink_within_workspace() {
    let ws = tempfile::tempdir().unwrap();
    std::fs::write(ws.path().join("real.md"), "REAL-CONTENT").unwrap();
    std::os::unix::fs::symlink(ws.path().join("real.md"), ws.path().join("alias.txt")).unwrap();

    let mut params = HashMap::new();
    params.insert("path".to_string(), ".".to_string());
    params.insert("accept".to_string(), "*.txt".to_string());
    let output = execute_action("action/read-folder", &params, ws.path())
        .await
        .unwrap();
    assert!(output.contains("REAL-CONTENT"));
}

#[test]
fn test_matches_accept_comma_separated_list() {
    assert!(matches_accept("readme.md", "*.md,*.txt"));
    assert!(matches_accept("notes.txt", "*.md,*.txt"));
    assert!(!matches_accept("image.png", "*.md,*.txt"));
    // Whitespace around patterns is tolerated.
    assert!(matches_accept("notes.txt", "*.md, *.txt"));
    // Empty accept behaves like "*" (matches everything).
    assert!(matches_accept("anything.bin", ""));
}
