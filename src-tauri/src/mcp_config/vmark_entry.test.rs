//! Tests for `vmark_entry.rs` (included via `#[path]`).
//!
//! Edge cases of the legacy-`--port` strip that the format-level tests in
//! `config_io.test.rs` do not reach.

use super::*;
use toml_edit::DocumentMut;

/// Fixed per-client credential — its own rules live in
/// `client_token_field.test.rs`.
const TOK: &str = "tok-fixture";

/// A `mcp_servers` standard table holding `vmark = { … }` parsed from TOML
/// text, so the tests exercise the same document model the app does.
fn toml_servers(vmark_body: &str) -> DocumentMut {
    format!("[mcp_servers.vmark]\n{vmark_body}")
        .parse::<DocumentMut>()
        .expect("fixture is valid TOML")
}

/// Run the upsert over a parsed fixture's `mcp_servers` table.
fn upsert_into(doc: &mut DocumentMut, binary_path: &str) -> Result<(), String> {
    let servers = doc
        .as_table_mut()
        .get_mut("mcp_servers")
        .expect("fixture has mcp_servers");
    let style = TomlEntryStyle::of_parent(servers);
    upsert_toml_vmark(
        servers.as_table_like_mut().unwrap(),
        style,
        binary_path,
        TOK,
    )
}

#[test]
fn no_args_key_means_nothing_to_strip() {
    assert!(legacy_port_arg_indices(&[]).is_empty());
}

#[test]
fn a_trailing_port_flag_with_no_value_is_still_dropped() {
    let args = vec!["--verbose".to_string(), LEGACY_PORT_FLAG.to_string()];
    assert_eq!(legacy_port_arg_indices(&args), vec![1]);
}

#[test]
fn repeated_port_pairs_are_all_dropped() {
    let args: Vec<String> = ["--port", "1", "--keep", "--port", "2"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(legacy_port_arg_indices(&args), vec![0, 1, 3, 4]);
}

#[test]
fn a_port_value_that_looks_like_a_flag_is_still_consumed_as_the_value() {
    // `--port --verbose` is malformed either way; consuming both is what the
    // sidecar's own argv parsing would have done, and leaving `--verbose`
    // stranded as a port value would be worse.
    let args: Vec<String> = ["--port", "--verbose"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(legacy_port_arg_indices(&args), vec![0, 1]);
}

#[test]
fn non_string_args_are_preserved_rather_than_misidentified() {
    // A numeric arg stringifies to "" in the scan; it must not be dropped.
    let mut servers = serde_json::Map::new();
    servers.insert(
        "vmark".to_string(),
        serde_json::json!({ "args": [7, "--port", "9223"] }),
    );
    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();
    let args = servers["vmark"]["args"].as_array().unwrap();
    assert_eq!(args.len(), 1);
    assert_eq!(args[0], 7);
}

#[test]
fn an_absent_entry_is_created_with_just_our_fields() {
    // Exactly the two fields VMark owns: the binary path and the per-client
    // credential. Nothing else is invented on the user's behalf.
    let mut servers = serde_json::Map::new();
    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();
    let entry = servers["vmark"].as_object().unwrap();
    assert_eq!(entry.len(), 2);
    assert_eq!(entry["command"], "/bin/vmark");
    assert_eq!(entry["env"]["VMARK_MCP_TOKEN"], TOK);

    let mut doc = DocumentMut::new();
    let mut created = Table::new();
    created.set_implicit(true);
    doc.as_table_mut()
        .insert("mcp_servers", TomlItem::Table(created));
    upsert_into(&mut doc, "/bin/vmark").unwrap();
    assert_eq!(
        doc.to_string(),
        format!(
            "[mcp_servers.vmark]\ncommand = \"/bin/vmark\"\n\n[mcp_servers.vmark.env]\nVMARK_MCP_TOKEN = \"{TOK}\"\n"
        )
    );
}

#[test]
fn an_absent_entry_under_an_inline_parent_is_created_inline() {
    // `Item::Table` inside an `InlineTable` is a `toml_edit` panic, not just
    // invalid TOML. The style must follow the parent the user wrote.
    let mut doc = "mcp_servers = { other = { command = \"/o\" } }\n"
        .parse::<DocumentMut>()
        .unwrap();
    upsert_into(&mut doc, "/bin/vmark").unwrap();

    let out = doc.to_string();
    assert!(!out.contains('['), "must stay inline, got: {out}");
    assert!(
        out.contains(&format!(
            "vmark = {{ command = \"/bin/vmark\", env = {{ VMARK_MCP_TOKEN = \"{TOK}\" }} }}"
        )),
        "{out}"
    );
}

/// The `env` table's style follows the ENTRY, not `mcp_servers`: a standard
/// `[mcp_servers]` may hold an inline `vmark = { … }`, and inserting a
/// standard `Item::Table` into an `InlineTable` PANICS inside `toml_edit`.
#[test]
fn an_inline_entry_under_a_standard_parent_gets_an_inline_env() {
    let mut doc = "[mcp_servers]\nvmark = { command = \"/old\" }\n"
        .parse::<DocumentMut>()
        .unwrap();
    upsert_into(&mut doc, "/bin/vmark").unwrap();

    let out = doc.to_string();
    assert!(
        out.parse::<DocumentMut>().is_ok(),
        "still valid TOML: {out}"
    );
    assert!(out.contains("env = {"), "{out}");
}

// -- what the `args` key survives ------------------------------------------
//
// Round-2 finding 3. The `args` key only disappears when the legacy
// `--port <n>` pair was the ONLY thing in it — i.e. when the list we emptied
// is one we ourselves filled. Anything else in there is the user's.

#[test]
fn an_args_list_the_user_left_empty_survives_json() {
    // `args: []` carries intent and is not our legacy artifact. Round 1
    // removed it because it only looked at whether the list ended up empty.
    let mut servers = serde_json::Map::new();
    servers.insert("vmark".to_string(), serde_json::json!({ "args": [] }));

    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();

    assert_eq!(
        servers["vmark"].get("args"),
        Some(&serde_json::json!([])),
        "an empty args array the user wrote must come back out"
    );
}

#[test]
fn an_args_list_the_user_left_empty_survives_toml() {
    let mut doc = toml_servers("args = []\n");

    upsert_into(&mut doc, "/bin/vmark").unwrap();

    let out = doc.to_string();
    assert!(
        out.contains("args = []"),
        "an empty args array the user wrote must come back out: {out}"
    );
}

#[test]
fn args_holding_only_the_legacy_pair_lose_the_key_entirely() {
    let mut servers = serde_json::Map::new();
    servers.insert(
        "vmark".to_string(),
        serde_json::json!({ "args": ["--port", "1234"] }),
    );

    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();

    assert!(
        servers["vmark"].get("args").is_none(),
        "a list that held only our own legacy pair goes with it"
    );

    let mut doc = toml_servers("args = [\"--port\", \"1234\"]\n");

    upsert_into(&mut doc, "/bin/vmark").unwrap();

    let out = doc.to_string();
    assert!(!out.contains("args"), "the key goes with the pair: {out}");
}

#[test]
fn a_multi_line_args_array_keeps_its_leading_trivia_when_the_pair_goes() {
    // The newline and comment that open a multi-line array belong to the
    // array, not to the `--port` element being deleted.
    let mut doc = toml_servers(
        "args = [\n  # ours, obsolete\n  \"--port\",\n  \"9223\",\n  \"--verbose\",\n]\n",
    );

    upsert_into(&mut doc, "/bin/vmark").unwrap();

    let out = doc.to_string();
    assert!(out.contains("# ours, obsolete"), "{out}");
    assert!(out.contains("\"--verbose\""), "{out}");
    assert!(!out.contains("9223"), "{out}");
    out.parse::<toml::Table>()
        .unwrap_or_else(|e| panic!("{e}\n{out}"));
}

#[test]
fn args_around_the_legacy_pair_are_kept() {
    let mut servers = serde_json::Map::new();
    servers.insert(
        "vmark".to_string(),
        serde_json::json!({ "args": ["--port", "1234", "--foo"] }),
    );

    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();

    assert_eq!(servers["vmark"]["args"], serde_json::json!(["--foo"]));
}

#[test]
fn a_non_array_args_value_is_left_alone_rather_than_rejected() {
    // Nonsense we did not write and do not own. Preserve it; the client will
    // complain if it matters.
    let mut servers = serde_json::Map::new();
    servers.insert(
        "vmark".to_string(),
        serde_json::json!({ "args": "--port 9223" }),
    );
    upsert_json_vmark(&mut servers, "/bin/vmark", TOK).unwrap();
    assert_eq!(servers["vmark"]["args"], "--port 9223");
}

#[test]
fn a_non_array_args_value_is_left_alone_in_toml_too() {
    let mut doc = toml_servers("args = \"--port 9223\"\n");
    upsert_into(&mut doc, "/bin/vmark").unwrap();
    assert!(doc.to_string().contains("args = \"--port 9223\""));
}

#[test]
fn a_non_table_toml_vmark_entry_is_rejected() {
    let mut doc = "[mcp_servers]\nvmark = 7\n".parse::<DocumentMut>().unwrap();
    let err = upsert_into(&mut doc, "/bin/vmark").expect_err("7 is not a table");
    assert!(err.contains("mcp_servers.vmark is not a table"), "{err}");
}
