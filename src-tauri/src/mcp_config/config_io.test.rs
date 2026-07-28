//! Tests for `config_io.rs` (included via `#[path]`).
//!
//! WI-2 — `mcp_config` parse failures must propagate instead of silently
//! rewriting the user's config as a vmark-only file.

use super::*;

const BIN: &str = "/opt/vmark/vmark-mcp-server";
/// The per-client credential written to `env.VMARK_MCP_TOKEN`. Fixed here so
/// these tests keep asserting *content merging*; the credential's own rules
/// live in `client_token_field.test.rs` and `client_tokens.test.rs`.
const TOK: &str = "tok-fixture";

// -- generate_config_content: malformed input must not be swallowed --------
//
// `~/.claude.json` holds Claude Code's ENTIRE state, not just MCP servers.
// Parsing it with `.ok()` and falling back to `{}` turns one corrupt byte
// into total settings loss.

#[test]
fn malformed_json_is_rejected() {
    let err = generate_config_content("claude", BIN, TOK, Some("{ not json"))
        .expect_err("malformed JSON must not fall back to an empty config");
    assert!(err.contains("Invalid JSON"), "unexpected error: {err}");
}

#[test]
fn malformed_toml_is_rejected() {
    let err = generate_config_content("codex", BIN, TOK, Some("this is = not = toml"))
        .expect_err("malformed TOML must not fall back to an empty config");
    assert!(err.contains("Invalid TOML"), "unexpected error: {err}");
}

#[test]
fn json_top_level_non_object_is_rejected() {
    let err = generate_config_content("gemini", BIN, TOK, Some("[1, 2, 3]"))
        .expect_err("a top-level JSON array is not a config object");
    assert!(err.contains("Invalid JSON structure"), "unexpected: {err}");
}

#[test]
fn json_non_object_mcp_servers_is_rejected() {
    let err = generate_config_content("claude", BIN, TOK, Some(r#"{"mcpServers": "oops"}"#))
        .expect_err("a non-object mcpServers cannot receive the vmark entry");
    assert!(
        err.contains("mcpServers is not an object"),
        "unexpected: {err}"
    );
}

#[test]
fn toml_non_table_mcp_servers_is_rejected() {
    // Symmetry with the JSON path: the old code silently skipped insertion
    // and reported a successful install with vmark absent.
    let err = generate_config_content("codex", BIN, TOK, Some(r#"mcp_servers = "oops""#))
        .expect_err("a non-table mcp_servers cannot receive the vmark entry");
    assert!(
        err.contains("mcp_servers is not a table"),
        "unexpected: {err}"
    );
}

#[test]
fn unknown_provider_is_rejected() {
    let err = generate_config_content("nope", BIN, TOK, None).expect_err("unknown provider");
    assert!(err.contains("Unknown provider"), "unexpected: {err}");
}

// -- generate_config_content: valid input round-trips ----------------------

#[test]
fn json_preserves_unrelated_keys() {
    let existing = r#"{
      "numStartups": 42,
      "projects": { "/tmp/x": { "allowedTools": ["Read"] } },
      "mcpServers": { "other": { "command": "/usr/bin/other" } }
    }"#;
    let out =
        generate_config_content("claude", BIN, TOK, Some(existing)).expect("valid JSON merges");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();

    assert_eq!(json["numStartups"], 42);
    assert_eq!(json["projects"]["/tmp/x"]["allowedTools"][0], "Read");
    assert_eq!(json["mcpServers"]["other"]["command"], "/usr/bin/other");
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);
}

#[test]
fn toml_preserves_unrelated_keys() {
    let existing = r#"
model = "gpt-5"
approval_policy = "on-request"

[mcp_servers.other]
command = "/usr/bin/other"
"#;
    let out =
        generate_config_content("codex", BIN, TOK, Some(existing)).expect("valid TOML merges");
    let doc: toml::Table = out.parse().unwrap();

    assert_eq!(doc["model"].as_str(), Some("gpt-5"));
    assert_eq!(doc["approval_policy"].as_str(), Some("on-request"));
    assert_eq!(
        doc["mcp_servers"]["other"]["command"].as_str(),
        Some("/usr/bin/other")
    );
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[test]
fn absent_config_produces_a_fresh_one() {
    let json_out = generate_config_content("claude", BIN, TOK, None).expect("fresh JSON install");
    let json: serde_json::Value = serde_json::from_str(&json_out).unwrap();
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);

    let toml_out = generate_config_content("codex", BIN, TOK, None).expect("fresh TOML install");
    let doc: toml::Table = toml_out.parse().unwrap();
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[test]
fn empty_config_file_is_treated_as_fresh() {
    // A zero-byte file is not valid JSON. Erroring on it would strand users
    // whose client created the file but never wrote to it.
    let json_out = generate_config_content("claude", BIN, TOK, Some("")).expect("empty JSON file");
    let json: serde_json::Value = serde_json::from_str(&json_out).unwrap();
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);

    let toml_out =
        generate_config_content("codex", BIN, TOK, Some("   \n  ")).expect("blank TOML file");
    let doc: toml::Table = toml_out.parse().unwrap();
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

// -- upsert: we own `command`, the user owns everything else ---------------
//
// Replacing the whole `vmark` object is the same class of bug as replacing
// the whole `mcpServers` object, one level deeper: it silently discards the
// user's `env`, extra `args`, timeouts and provider-specific options on every
// install. Only the fields we own may change.

#[test]
fn existing_vmark_entry_is_updated_in_place() {
    let existing = r#"{"mcpServers": {"vmark": {"command": "/old/path"}}}"#;
    let out = generate_config_content("claude", BIN, TOK, Some(existing)).unwrap();
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);
}

#[test]
fn json_upsert_preserves_sibling_fields_on_our_own_entry() {
    let existing = r#"{
      "mcpServers": {
        "vmark": {
          "command": "/old/path",
          "env": { "VMARK_DEBUG": "1" },
          "timeout": 30000,
          "disabled": false,
          "args": ["--verbose"]
        }
      }
    }"#;
    let out =
        generate_config_content("claude", BIN, TOK, Some(existing)).expect("valid JSON merges");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    let vmark = &json["mcpServers"]["vmark"];

    assert_eq!(vmark["command"], BIN, "we own command");
    assert_eq!(vmark["env"]["VMARK_DEBUG"], "1", "user env must survive");
    assert_eq!(vmark["timeout"], 30000, "user timeout must survive");
    assert_eq!(vmark["disabled"], false, "user flags must survive");
    assert_eq!(
        vmark["args"][0], "--verbose",
        "user args must survive; only legacy --port is ours to drop"
    );
}

#[test]
fn json_upsert_drops_the_legacy_port_args_but_keeps_the_rest() {
    // Installs before the file-based port handshake wrote `--port <n>`. That
    // pair is genuinely obsolete and ours to remove; nothing else is.
    let existing = r#"{
      "mcpServers": {
        "vmark": { "command": "/old", "args": ["--port", "9223", "--verbose"] }
      }
    }"#;
    let out = generate_config_content("claude", BIN, TOK, Some(existing)).unwrap();
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    let args = json["mcpServers"]["vmark"]["args"].as_array().unwrap();
    assert_eq!(args.len(), 1, "only --verbose should remain: {args:?}");
    assert_eq!(args[0], "--verbose");
}

#[test]
fn json_upsert_removes_an_args_array_that_held_only_the_legacy_port() {
    let existing = r#"{"mcpServers": {"vmark": {"args": ["--port", "9223"]}}}"#;
    let out = generate_config_content("claude", BIN, TOK, Some(existing)).unwrap();
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert!(
        json["mcpServers"]["vmark"].get("args").is_none(),
        "an emptied args array is noise, not configuration"
    );
    assert_eq!(json["mcpServers"]["vmark"]["command"], BIN);
}

#[test]
fn json_non_object_vmark_entry_is_rejected() {
    let err = generate_config_content("claude", BIN, TOK, Some(r#"{"mcpServers": {"vmark": 7}}"#))
        .expect_err("a non-object vmark entry cannot be upserted into");
    assert!(
        err.contains("mcpServers.vmark is not an object"),
        "unexpected: {err}"
    );
}

#[test]
fn toml_upsert_preserves_sibling_fields_on_our_own_entry() {
    let existing = r#"
[mcp_servers.vmark]
command = "/old/path"
startup_timeout_ms = 20000
args = ["--verbose"]

[mcp_servers.vmark.env]
VMARK_DEBUG = "1"
"#;
    let out =
        generate_config_content("codex", BIN, TOK, Some(existing)).expect("valid TOML merges");
    let doc: toml::Table = out.parse().unwrap();
    let vmark = &doc["mcp_servers"]["vmark"];

    assert_eq!(vmark["command"].as_str(), Some(BIN));
    assert_eq!(vmark["startup_timeout_ms"].as_integer(), Some(20000));
    assert_eq!(vmark["env"]["VMARK_DEBUG"].as_str(), Some("1"));
    assert_eq!(vmark["args"][0].as_str(), Some("--verbose"));
}

#[test]
fn toml_upsert_drops_the_legacy_port_args_but_keeps_the_rest() {
    let existing = r#"
[mcp_servers.vmark]
command = "/old"
args = ["--port", "9223", "--verbose"]
"#;
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();
    let doc: toml::Table = out.parse().unwrap();
    let args = doc["mcp_servers"]["vmark"]["args"].as_array().unwrap();
    assert_eq!(args.len(), 1, "only --verbose should remain: {args:?}");
    assert_eq!(args[0].as_str(), Some("--verbose"));
}

#[test]
fn toml_upsert_removes_an_args_array_that_held_only_the_legacy_port() {
    let existing = "[mcp_servers.vmark]\nargs = [\"--port\", \"9223\"]\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();
    let doc: toml::Table = out.parse().unwrap();
    assert!(doc["mcp_servers"]["vmark"].get("args").is_none());
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[test]
fn toml_non_table_vmark_entry_is_rejected() {
    let err = generate_config_content("codex", BIN, TOK, Some("[mcp_servers]\nvmark = 7\n"))
        .expect_err("a non-table vmark entry cannot be upserted into");
    assert!(
        err.contains("mcp_servers.vmark is not a table"),
        "unexpected: {err}"
    );
}

// -- format classification is defined once (finding 8) ---------------------

#[test]
fn every_shipped_provider_classifies_to_exactly_one_format() {
    for provider in super::super::providers::PROVIDERS {
        let format = config_format(provider.id)
            .unwrap_or_else(|e| panic!("provider {} has no format: {e}", provider.id));
        let expected = if provider.id == "codex" {
            ConfigFormat::Toml
        } else {
            ConfigFormat::Json
        };
        assert_eq!(format, expected, "provider {}", provider.id);
    }
    config_format("nope").expect_err("unknown providers have no format");
}

// -- remove_vmark_from_config: already correct; lock the behavior in -------

#[test]
fn uninstall_rejects_malformed_json() {
    let err = remove_vmark_from_config("claude", "{ not json").expect_err("malformed JSON");
    assert!(err.contains("Invalid JSON"), "unexpected: {err}");
}

#[test]
fn uninstall_rejects_malformed_toml() {
    let err = remove_vmark_from_config("codex", "= = =").expect_err("malformed TOML");
    assert!(err.contains("Invalid TOML"), "unexpected: {err}");
}

#[test]
fn uninstall_preserves_unrelated_keys() {
    let existing = r#"{"numStartups": 7, "mcpServers": {"vmark": {"command": "x"}, "other": {}}}"#;
    let out = remove_vmark_from_config("claude", existing)
        .unwrap()
        .expect("vmark was present, so the document changed");
    let json: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(json["numStartups"], 7);
    assert!(json["mcpServers"]["other"].is_object());
    assert!(json["mcpServers"].get("vmark").is_none());
}

#[test]
fn uninstall_reports_nothing_to_remove_rather_than_reformatting() {
    // Re-serializing a config we did not change rewrites the user's file for
    // nothing — and, without `preserve_order`, re-sorts every key in it.
    for (provider, content) in [
        ("claude", r#"{"numStartups":7,"mcpServers":{"other":{}}}"#),
        ("claude", r#"{"numStartups":7}"#),
        ("claude", r#"{"mcpServers":"not an object"}"#),
        (
            "codex",
            "model = \"gpt-5\"\n[mcp_servers.other]\ncommand = \"y\"\n",
        ),
        ("codex", "model = \"gpt-5\"\n"),
        ("codex", "mcp_servers = 3\n"),
    ] {
        assert_eq!(
            remove_vmark_from_config(provider, content).unwrap(),
            None,
            "{provider} / {content}"
        );
    }
}

#[test]
fn uninstall_rejects_an_unknown_provider() {
    let err = remove_vmark_from_config("nope", "{}").expect_err("unknown provider");
    assert!(err.contains("Unknown provider"), "unexpected: {err}");
}

// -- key order must survive a round trip ----------------------------------
//
// `serde_json::Map` is a `BTreeMap` unless the `preserve_order` feature is on,
// so parsing and re-serialising ALPHABETISES every key at every nesting level.
// Installing rewrote the user's whole `~/.claude.json` into sorted order — not
// data loss, but a total-file diff on a config people keep in dotfile repos,
// and one that makes a real change impossible to spot in review.

#[test]
fn installing_does_not_reorder_the_users_json_keys() {
    // Deliberately not alphabetical: sorting would move every one of these.
    let existing = r#"{
  "zulu": 1,
  "mcpServers": {},
  "alpha": 2,
  "numFailedLoginAttempts": 0
}"#;

    let out = generate_config_content("claude", BIN, TOK, Some(existing)).unwrap();

    let pos = |k: &str| {
        out.find(k)
            .unwrap_or_else(|| panic!("{k} missing from:\n{out}"))
    };
    assert!(
        pos("zulu") < pos("mcpServers")
            && pos("mcpServers") < pos("alpha")
            && pos("alpha") < pos("numFailedLoginAttempts"),
        "the user's key order must survive the round trip, got:\n{out}"
    );
}

#[test]
fn installing_does_not_reorder_keys_inside_the_users_own_entries() {
    // Nested objects sort too, so a sibling server's fields get shuffled.
    let existing = r#"{
  "mcpServers": {
    "theirs": {
      "command": "/usr/bin/theirs",
      "args": ["--flag"],
      "env": {"ZED": "1", "ABLE": "2"}
    }
  }
}"#;

    let out = generate_config_content("claude", BIN, TOK, Some(existing)).unwrap();

    let pos = |k: &str| {
        out.find(k)
            .unwrap_or_else(|| panic!("{k} missing from:\n{out}"))
    };
    assert!(
        pos("\"command\"") < pos("\"args\"") && pos("\"args\"") < pos("\"env\""),
        "a sibling server's field order must survive, got:\n{out}"
    );
    assert!(
        pos("ZED") < pos("ABLE"),
        "even env vars must not be alphabetised, got:\n{out}"
    );
}

// -- `~/.codex/config.toml` is hand-written prose, not machine state -------
//
// The TOML path parsed into a `toml::Table` and re-emitted with
// `to_string_pretty`. That round trip destroys EVERY comment and re-orders
// EVERY key. `preserve_order` cannot fix it: no serde flag can give a comment
// back — only a format-preserving document model can, which is why the TOML
// side moved to `toml_edit`. Users hand-write and hand-comment this file, so
// the loss is their work, not cosmetic churn.

/// A config exercising every kind of trivia a round trip can eat: a two-line
/// header comment, a blank line, a trailing same-line comment, a comment above
/// a key, a comment above a table header, non-alphabetical keys, and a comment
/// at end of file.
const HAND_WRITTEN_CODEX: &str = r#"# Codex configuration.
# Hand written, hand commented — do not machine-format.

model = "gpt-5"   # my default
# Ask before anything destructive.
approval_policy = "on-request"
zulu = 1
alpha = 2

# Someone else's MCP server.
[mcp_servers.other]
command = "/usr/bin/other"
args = ["--stdio"]

# end of file
"#;

/// Every line of `before` must still appear in `after`, in the same relative
/// order and byte-identical. New lines may only be inserted between them.
fn assert_lines_survive(before: &str, after: &str) {
    let mut rest = after.lines();
    for line in before.lines() {
        assert!(
            rest.by_ref().any(|l| l == line),
            "line vanished or was rewritten: {line:?}\n--- after ---\n{after}"
        );
    }
}

#[test]
fn toml_install_keeps_every_comment() {
    let out = generate_config_content("codex", BIN, TOK, Some(HAND_WRITTEN_CODEX)).unwrap();

    for comment in [
        "# Codex configuration.",
        "# Hand written, hand commented — do not machine-format.",
        "# Ask before anything destructive.",
        "# Someone else's MCP server.",
        "# end of file",
    ] {
        assert!(out.contains(comment), "lost {comment:?} from:\n{out}");
    }
    assert!(
        out.contains(r#"model = "gpt-5"   # my default"#),
        "a trailing same-line comment (and its spacing) must survive:\n{out}"
    );
    assert_lines_survive(HAND_WRITTEN_CODEX, &out);

    let doc: toml::Table = out.parse().expect("still valid TOML");
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[test]
fn toml_install_keeps_non_alphabetical_key_order() {
    // `zulu` before `alpha`, `model` before both: sorting would move all three.
    let out = generate_config_content("codex", BIN, TOK, Some(HAND_WRITTEN_CODEX)).unwrap();

    let pos = |k: &str| {
        out.find(k)
            .unwrap_or_else(|| panic!("{k} missing from:\n{out}"))
    };
    assert!(
        pos("model") < pos("approval_policy")
            && pos("approval_policy") < pos("zulu")
            && pos("zulu") < pos("alpha"),
        "the user's key order must survive, got:\n{out}"
    );
}

#[test]
fn toml_install_keeps_blank_lines_and_section_grouping() {
    let existing = "[alpha]\none = 1\n\n[bravo]\ntwo = 2\n\n[mcp_servers.other]\ncommand = \"y\"\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();

    let blanks = |s: &str| s.lines().filter(|l| l.is_empty()).count();
    assert!(
        blanks(&out) >= blanks(existing),
        "blank-line grouping was collapsed:\n{out}"
    );
    let pos = |k: &str| out.find(k).unwrap();
    assert!(
        pos("[alpha]") < pos("[bravo]") && pos("[bravo]") < pos("[mcp_servers.other]"),
        "section order must survive:\n{out}"
    );
    assert_lines_survive(existing, &out);
}

#[test]
fn toml_installing_twice_is_byte_identical() {
    let once = generate_config_content("codex", BIN, TOK, Some(HAND_WRITTEN_CODEX)).unwrap();
    let twice = generate_config_content("codex", BIN, TOK, Some(&once)).unwrap();
    assert_eq!(twice, once, "a repeat install must not churn the file");
}

#[test]
fn toml_changing_only_the_command_touches_exactly_one_line() {
    // The test that actually proves the feature: a Repair that rewrites the
    // sidecar path must produce a one-line diff, not a whole-file rewrite.
    let before =
        generate_config_content("codex", "/old/vmark", TOK, Some(HAND_WRITTEN_CODEX)).unwrap();
    let after = generate_config_content("codex", "/new/vmark", TOK, Some(&before)).unwrap();

    assert_eq!(
        before.lines().count(),
        after.lines().count(),
        "line count changed:\n--- before ---\n{before}\n--- after ---\n{after}"
    );
    let differing: Vec<(&str, &str)> = before
        .lines()
        .zip(after.lines())
        .filter(|(a, b)| a != b)
        .collect();
    assert_eq!(
        differing.len(),
        1,
        "exactly one line may differ, got {differing:#?}"
    );
    assert_eq!(differing[0].0.trim(), r#"command = "/old/vmark""#);
    assert_eq!(differing[0].1.trim(), r#"command = "/new/vmark""#);
}

#[test]
fn toml_reinstalling_the_same_command_leaves_the_users_quoting_alone() {
    // A literal (single-quoted) string is the user's formatting, not ours.
    // Re-writing an unchanged value would rewrite it as a basic string.
    // The credential table is appended; the command line is untouched.
    let existing = "[mcp_servers.vmark]\ncommand = '/opt/vmark/vmark-mcp-server'\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();
    assert!(
        out.starts_with(existing),
        "an unchanged command must not be rewritten:\n{out}"
    );
    assert!(out.contains("VMARK_MCP_TOKEN = \"tok-fixture\""), "{out}");
}

/// Installing twice in a row is a no-op the second time — including the
/// credential, which is passed in unchanged and must not be re-emitted.
#[test]
fn toml_reinstalling_is_byte_identical_the_second_time() {
    let once = generate_config_content("codex", BIN, TOK, Some(HAND_WRITTEN_CODEX)).unwrap();
    let twice = generate_config_content("codex", BIN, TOK, Some(&once)).unwrap();
    assert_eq!(once, twice);
}

#[test]
fn toml_uninstall_restores_the_file_byte_for_byte() {
    let installed = generate_config_content("codex", BIN, TOK, Some(HAND_WRITTEN_CODEX)).unwrap();
    let out = remove_vmark_from_config("codex", &installed)
        .unwrap()
        .expect("vmark was present, so the document changed");
    assert_eq!(
        out, HAND_WRITTEN_CODEX,
        "install + uninstall must be a no-op on the user's bytes"
    );
}

#[test]
fn toml_uninstall_keeps_comments_and_sibling_entries() {
    let existing = "\
# keep me
model = \"gpt-5\"

[mcp_servers.vmark]
command = \"/opt/vmark\"

# theirs
[mcp_servers.other]
command = \"/usr/bin/other\"
";
    let out = remove_vmark_from_config("codex", existing)
        .unwrap()
        .expect("vmark was present");

    assert!(out.contains("# keep me"), "lost a comment:\n{out}");
    assert!(out.contains("# theirs"), "lost a comment:\n{out}");
    assert!(out.contains("[mcp_servers.other]"), "lost a server:\n{out}");
    assert!(!out.contains("vmark"), "vmark should be gone:\n{out}");
}

#[test]
fn toml_install_keeps_an_inline_mcp_servers_table_inline() {
    // Inserting a standard `[table]` inside an inline one is invalid TOML —
    // and, in `toml_edit`, a panic. The style the user chose must be kept.
    let existing = "mcp_servers = { other = { command = \"/usr/bin/other\" } }\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();

    assert!(
        !out.contains("[mcp_servers"),
        "an inline table must not sprout a table header:\n{out}"
    );
    let doc: toml::Table = out.parse().expect("still valid TOML");
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
    assert_eq!(
        doc["mcp_servers"]["other"]["command"].as_str(),
        Some("/usr/bin/other")
    );
}

#[test]
fn toml_install_into_a_dotted_mcp_servers_key_stays_valid() {
    // A dotted key is also a value context: a standard sub-table cannot live
    // under it.
    let existing = "mcp_servers.other.command = \"/usr/bin/other\"\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();

    let doc: toml::Table = out.parse().unwrap_or_else(|e| panic!("{e}\n{out}"));
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
    assert_eq!(
        doc["mcp_servers"]["other"]["command"].as_str(),
        Some("/usr/bin/other")
    );
}

#[test]
fn toml_install_keeps_comments_on_our_own_entry() {
    // We own `command`. The comment the user wrote above it is still theirs.
    let existing = "\
[mcp_servers.vmark]
# pinned by hand after the 0.9 upgrade
command = \"/old/vmark\"
startup_timeout_ms = 20000
";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();

    assert!(
        out.contains("# pinned by hand after the 0.9 upgrade"),
        "a comment on our own entry is still the user's:\n{out}"
    );
    assert!(out.contains("startup_timeout_ms = 20000"), "{out}");
    let doc: toml::Table = out.parse().unwrap();
    assert_eq!(doc["mcp_servers"]["vmark"]["command"].as_str(), Some(BIN));
}

#[test]
fn toml_install_keeps_a_trailing_comment_on_the_command_line() {
    let existing = "[mcp_servers.vmark]\ncommand = \"/old/vmark\"  # set by the installer\n";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();
    assert!(
        out.starts_with(&format!(
            "[mcp_servers.vmark]\ncommand = \"{BIN}\"  # set by the installer\n"
        )),
        "only the command's value may change on that line:\n{out}"
    );
    // The credential lands in its own sub-table, after the entry's own keys.
    assert!(
        out.contains("[mcp_servers.vmark.env]\nVMARK_MCP_TOKEN = \"tok-fixture\""),
        "{out}"
    );
}

#[test]
fn toml_stripping_the_legacy_port_keeps_the_rest_of_the_file() {
    let existing = "\
# header
model = \"gpt-5\"

[mcp_servers.vmark]
command = \"/old/vmark\"
args = [\"--port\", \"9223\", \"--verbose\"]
";
    let out = generate_config_content("codex", BIN, TOK, Some(existing)).unwrap();

    assert!(out.contains("# header"), "{out}");
    assert!(out.contains("model = \"gpt-5\""), "{out}");
    let doc: toml::Table = out.parse().unwrap();
    let args = doc["mcp_servers"]["vmark"]["args"].as_array().unwrap();
    assert_eq!(args.len(), 1, "{args:?}");
    assert_eq!(args[0].as_str(), Some("--verbose"));
}

// -- read_existing_config: absent, parseable and broken are three states ----
//
// `mcp_config_diagnose` derives "not installed" from `has_vmark == false`.
// Swallowing a read or parse failure into that same `false` told the user
// their config had no vmark entry when the truth was that VMark could not
// make sense of the file at all.

use std::fs;
use tempfile::tempdir;

#[test]
fn read_existing_config_reports_an_absent_file_as_absent() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    let found = read_existing_config(&path, "claude").expect("a known provider");
    assert!(
        matches!(found, ExistingConfig::Absent),
        "a file that is not there is not a broken file"
    );
}

#[test]
fn read_existing_config_finds_an_installed_vmark_entry() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(
        &path,
        format!(r#"{{"mcpServers":{{"vmark":{{"command":"{BIN}"}}}}}}"#),
    )
    .unwrap();

    match read_existing_config(&path, "claude").expect("valid JSON parses") {
        ExistingConfig::Parsed {
            has_vmark,
            binary_path,
        } => {
            assert!(has_vmark);
            assert_eq!(
                binary_path.as_deref(),
                Some(BIN),
                "the command comes out of the same parse"
            );
        }
        other => panic!("expected Parsed, got {other:?}"),
    }
}

#[test]
fn read_existing_config_reports_a_valid_config_without_vmark() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(
        &path,
        r#"{"mcpServers":{"other":{"command":"/usr/bin/other"}}}"#,
    )
    .unwrap();

    match read_existing_config(&path, "claude").expect("valid JSON parses") {
        ExistingConfig::Parsed { has_vmark, .. } => assert!(!has_vmark),
        other => panic!("expected Parsed, got {other:?}"),
    }
}

#[test]
fn read_existing_config_reports_malformed_json_as_unreadable() {
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    // Claude Code's entire state lives here. "No vmark entry" is a lie about
    // this file; "VMark cannot parse it" is the truth.
    fs::write(&path, r#"{"projects": {"/tmp/x": {}}, TRUNCATED"#).unwrap();

    match read_existing_config(&path, "claude").expect("a known provider") {
        ExistingConfig::Unreadable { detail } => {
            assert!(detail.contains("Invalid JSON"), "unexpected: {detail}");
        }
        other => panic!("expected Unreadable, got {other:?}"),
    }
}

#[test]
fn read_existing_config_reports_malformed_toml_as_unreadable() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("config.toml");
    fs::write(&path, "this is = not = toml").unwrap();

    match read_existing_config(&path, "codex").expect("a known provider") {
        ExistingConfig::Unreadable { detail } => {
            assert!(detail.contains("Invalid TOML"), "unexpected: {detail}");
        }
        other => panic!("expected Unreadable, got {other:?}"),
    }
}

#[test]
fn read_existing_config_reports_a_non_utf8_file_as_unreadable() {
    // Present but unreadable: `fs::read_to_string(..).ok()` collapsed this
    // into the same `None` as "no file yet".
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, [0xff, 0xfe, 0x00, 0x01]).unwrap();

    match read_existing_config(&path, "claude").expect("a known provider") {
        ExistingConfig::Unreadable { detail } => {
            assert!(detail.contains("Failed to read"), "unexpected: {detail}");
        }
        other => panic!("expected Unreadable, got {other:?}"),
    }
}

#[cfg(unix)]
#[test]
fn read_existing_config_reports_a_permission_denied_file_as_unreadable() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, r#"{"mcpServers":{}}"#).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();

    if fs::read_to_string(&path).is_ok() {
        // Running as root, where the mode bits do not apply. Nothing to prove.
        return;
    }
    match read_existing_config(&path, "claude").expect("a known provider") {
        ExistingConfig::Unreadable { detail } => {
            assert!(detail.contains("Failed to read"), "unexpected: {detail}");
        }
        other => panic!("expected Unreadable, got {other:?}"),
    }
}

#[test]
fn read_existing_config_rejects_an_unknown_provider() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("whatever.json");
    fs::write(&path, "{}").unwrap();
    let err = read_existing_config(&path, "nope").expect_err("unknown provider");
    assert!(err.contains("Unknown provider"), "unexpected: {err}");
}

#[test]
fn read_existing_config_treats_a_blank_file_as_present_but_unconfigured() {
    // A zero-byte file is not valid JSON, but clients do create one before
    // ever writing to it, and `generate_config_content` deliberately builds on
    // it (see `empty_config_file_is_treated_as_fresh`). Reporting it as broken
    // would deny Install to a config that installs perfectly well.
    let dir = tempdir().unwrap();
    let path = dir.path().join(".claude.json");
    fs::write(&path, "").unwrap();

    match read_existing_config(&path, "claude").expect("a known provider") {
        ExistingConfig::Parsed { has_vmark, .. } => assert!(!has_vmark),
        other => panic!("expected Parsed, got {other:?}"),
    }

    fs::write(&path, "   \n  ").unwrap();
    match read_existing_config(&path, "claude").expect("a known provider") {
        ExistingConfig::Parsed { has_vmark, .. } => assert!(!has_vmark),
        other => panic!("expected Parsed, got {other:?}"),
    }
}
