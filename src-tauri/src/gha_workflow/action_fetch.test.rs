//! Tests for the action metadata fetcher (extracted from action_fetch.rs
//! to keep the production file within the size gate).

use super::*;

#[test]
fn parse_uses_top_level_action() {
    let r = parse_uses("actions/checkout@v4").unwrap();
    assert_eq!(r.owner, "actions");
    assert_eq!(r.repo, "checkout");
    assert_eq!(r.path, "");
    assert_eq!(r.git_ref, "v4");
}

#[test]
fn parse_uses_subpath_action() {
    let r = parse_uses("actions/foo/sub/path@main").unwrap();
    assert_eq!(r.owner, "actions");
    assert_eq!(r.repo, "foo");
    assert_eq!(r.path, "sub/path");
    assert_eq!(r.git_ref, "main");
}

#[test]
fn parse_uses_sha_ref() {
    let r = parse_uses("actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332").unwrap();
    assert_eq!(r.git_ref, "692973e3d937129bcbf40652eb9f2f61becf3332");
}

#[test]
fn parse_uses_rejects_local_ref() {
    assert!(parse_uses("./.github/actions/setup").is_none());
}

#[test]
fn parse_uses_rejects_docker_uri() {
    assert!(parse_uses("docker://alpine:3.18").is_none());
}

#[test]
fn parse_uses_rejects_missing_ref() {
    assert!(parse_uses("actions/checkout").is_none());
}

#[test]
fn parse_uses_rejects_empty_ref() {
    assert!(parse_uses("actions/checkout@").is_none());
}

#[test]
fn parse_uses_rejects_traversal_attempts() {
    // Audit round 5: input validation hardens against owner/repo/
    // ref/path values that would coerce build_url into probing
    // arbitrary paths under raw.githubusercontent.com.
    assert!(parse_uses("..//evil@main").is_none());
    assert!(parse_uses("owner/..%2F..%2Fevil@main").is_none());
    assert!(parse_uses("owner/repo/..@main").is_none());
    assert!(parse_uses("owner/repo@..").is_none());
    // Control chars + spaces.
    assert!(parse_uses("owner/repo@ma in").is_none());
    assert!(parse_uses("owner/repo@\nmain").is_none());
    // Percent encoding (shouldn't appear in honest uses strings).
    assert!(parse_uses("owner/re%70o@main").is_none());
}

#[test]
fn parse_uses_accepts_legitimate_ref_shapes() {
    assert!(parse_uses("actions/checkout@v4").is_some());
    assert!(parse_uses("actions/checkout@v4.1.7").is_some());
    // 40-char SHA.
    assert!(parse_uses("actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332").is_some());
    // Branch with slash (`refs/heads/main` shape — uncommon but valid).
    assert!(parse_uses("actions/checkout@refs/heads/main").is_some());
    // Subpath action.
    assert!(parse_uses("github/super-linter/super-linter@v5.0.0").is_some());
}

#[test]
fn parse_uses_rejects_missing_repo() {
    assert!(parse_uses("@v4").is_none());
    assert!(parse_uses("actions@v4").is_none());
}

#[test]
fn build_url_top_level() {
    let r = ActionRef {
        owner: "actions".into(),
        repo: "checkout".into(),
        path: "".into(),
        git_ref: "v4".into(),
    };
    assert_eq!(
        build_url(&r, "action.yml"),
        "https://raw.githubusercontent.com/actions/checkout/v4/action.yml"
    );
}

#[test]
fn build_url_subpath() {
    let r = ActionRef {
        owner: "actions".into(),
        repo: "foo".into(),
        path: "sub/path".into(),
        git_ref: "main".into(),
    };
    assert_eq!(
        build_url(&r, "action.yaml"),
        "https://raw.githubusercontent.com/actions/foo/main/sub/path/action.yaml"
    );
}

#[test]
fn read_cache_returns_none_when_file_missing() {
    let p = std::env::temp_dir().join("does-not-exist-xyz.json");
    let _ = std::fs::remove_file(&p);
    assert!(read_cache(&p, 60).is_none());
}

#[test]
fn cache_roundtrip_within_ttl() {
    let p = std::env::temp_dir().join(format!("vmark-gha-cache-test-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&p);
    let metadata = ActionMetadata {
        name: Some("test".into()),
        description: Some("desc".into()),
        author: None,
        inputs: Default::default(),
        outputs: Default::default(),
        runs_using: Some("node20".into()),
    };
    write_cache(&p, &metadata).unwrap();
    let read = read_cache(&p, 60).unwrap();
    assert_eq!(read.name, metadata.name);
    assert_eq!(read.runs_using, metadata.runs_using);
    std::fs::remove_file(&p).ok();
}

#[test]
fn cache_returns_none_when_expired() {
    let p = std::env::temp_dir().join(format!(
        "vmark-gha-cache-expired-{}.json",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&p);
    // Manually craft a stale entry.
    let stale = CacheEntry {
        fetched_at: 0, // Jan 1, 1970 — definitely older than 1s
        metadata: ActionMetadata {
            name: None,
            description: None,
            author: None,
            inputs: Default::default(),
            outputs: Default::default(),
            runs_using: None,
        },
    };
    std::fs::write(&p, serde_json::to_vec(&stale).unwrap()).unwrap();
    assert!(read_cache(&p, 60).is_none());
    std::fs::remove_file(&p).ok();
}

// -- audit g3-rust-rest regression tests --------------------------------------

#[test]
fn parse_action_yml_maps_runs_using() {
    // Real action.yml nests the runtime under `runs: { using: ... }` —
    // the flat `runs_using` UI hint must be derived from it.
    let yaml = r#"
name: Checkout
description: Check out a repo
inputs:
  ref:
    description: The branch, tag or SHA to checkout.
    required: false
runs:
  using: node20
  main: dist/index.js
"#;
    let metadata = parse_action_yml(yaml).unwrap();
    assert_eq!(metadata.name.as_deref(), Some("Checkout"));
    assert_eq!(metadata.runs_using.as_deref(), Some("node20"));
    assert!(metadata.inputs.contains_key("ref"));
}

#[test]
fn parse_action_yml_composite() {
    let yaml = "name: X\nruns:\n  using: composite\n  steps: []\n";
    let metadata = parse_action_yml(yaml).unwrap();
    assert_eq!(metadata.runs_using.as_deref(), Some("composite"));
}

#[test]
fn parse_action_yml_without_runs_section() {
    let metadata = parse_action_yml("name: X\n").unwrap();
    assert_eq!(metadata.runs_using, None);
}

#[test]
fn cache_returns_none_when_fetched_at_is_far_future() {
    // A future-dated fetched_at (clock rollback, tampering) must not be
    // treated as forever-fresh via saturating_sub == 0.
    let p = std::env::temp_dir().join(format!(
        "vmark-gha-cache-future-{}.json",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&p);
    let future = CacheEntry {
        fetched_at: now_secs() + 86_400, // one day ahead
        metadata: ActionMetadata {
            name: None,
            description: None,
            author: None,
            inputs: Default::default(),
            outputs: Default::default(),
            runs_using: None,
        },
    };
    std::fs::write(&p, serde_json::to_vec(&future).unwrap()).unwrap();
    assert!(read_cache(&p, 60).is_none());
    std::fs::remove_file(&p).ok();
}

#[test]
fn cache_tolerates_small_clock_skew() {
    let p = std::env::temp_dir().join(format!("vmark-gha-cache-skew-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&p);
    let slightly_ahead = CacheEntry {
        fetched_at: now_secs() + 30, // within tolerance
        metadata: ActionMetadata {
            name: Some("skew".into()),
            description: None,
            author: None,
            inputs: Default::default(),
            outputs: Default::default(),
            runs_using: None,
        },
    };
    std::fs::write(&p, serde_json::to_vec(&slightly_ahead).unwrap()).unwrap();
    assert!(read_cache(&p, 60).is_some());
    std::fs::remove_file(&p).ok();
}
