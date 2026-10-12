// WI-RA5.4 — every documented workflow key parses, including the two the
// engine accepts without reading, and an undocumented key is refused.
//
//! Unit tests for the YAML wire structs in `types.rs`.

use super::*;

fn parse(yaml: &str) -> Result<RawWorkflow, crate::yaml::Error> {
    crate::yaml::from_str(yaml)
}

/// `description` and `limits.max_cost` are documented keys the engine does not
/// act on. The structs refuse unknown keys, so each must stay a field: delete
/// one as "unread" and every workflow that sets it stops running.
#[test]
fn the_keys_the_engine_does_not_act_on_are_still_accepted() {
    let workflow = parse(
        "name: w\ndescription: One line.\ndefaults:\n  limits:\n    max_cost: \"$2.00\"\n\
         steps:\n  - id: a\n    uses: action/copy\n    limits:\n      max_cost: 0.5\n",
    )
    .expect("documented keys parse");
    assert_eq!(workflow.description.as_deref(), Some("One line."));
    let default_cost = workflow.defaults.limits.and_then(|limits| limits.max_cost);
    assert_eq!(default_cost.as_deref(), Some("$2.00"));
    let step_cost = workflow.steps[0]
        .limits
        .as_ref()
        .and_then(|limits| limits.max_cost.as_deref());
    assert_eq!(step_cost, Some("0.5"));
}

#[test]
fn every_documented_key_parses() {
    let workflow = parse(
        "name: full\ndescription: d\nenv:\n  K: v\ndefaults:\n  model: m\n  approval: ask\n  \
         limits:\n    timeout: 30s\n    max_tokens: 100\n    max_cost: \"1\"\n\
         steps:\n  - id: a\n    uses: action/copy\n    with:\n      input: x\n  \
         - id: b\n    uses: genie/g\n    needs: a\n    if: success()\n    model: m2\n    \
         approval: auto\n    limits:\n      timeout: 120\n      max_tokens: 4096\n  \
         - id: c\n    uses: action/copy\n    needs: [a, b]\n",
    )
    .expect("the documented shape parses");
    assert_eq!(workflow.name, "full");
    assert_eq!(workflow.env.get("K").map(String::as_str), Some("v"));
    assert_eq!(workflow.defaults.model.as_deref(), Some("m"));
    assert_eq!(workflow.steps.len(), 3);
    assert!(workflow.steps[0].needs.to_vec().is_empty());
    assert_eq!(workflow.steps[1].needs.to_vec(), ["a"]);
    assert_eq!(workflow.steps[1].condition.as_deref(), Some("success()"));
    assert_eq!(workflow.steps[2].needs.to_vec(), ["a", "b"]);
    let limits = workflow.steps[1].limits.as_ref().expect("step limits");
    assert_eq!(limits.timeout.as_deref(), Some("120"));
    assert_eq!(limits.max_tokens, Some(4096));
}

#[test]
fn an_undocumented_key_is_refused_at_every_level() {
    for yaml in [
        "name: w\ndescripton: typo\nsteps: []\n",
        "name: w\ndefaults:\n  aproval: ask\nsteps: []\n",
        "name: w\ndefaults:\n  limits:\n    maxcost: \"1\"\nsteps: []\n",
        "name: w\nsteps:\n  - id: a\n    uses: action/copy\n    need: b\n",
        "name: w\nsteps:\n  - id: a\n    uses: action/copy\n    limits:\n      time_out: 5s\n",
    ] {
        assert!(parse(yaml).is_err(), "accepted: {yaml:?}");
    }
}
