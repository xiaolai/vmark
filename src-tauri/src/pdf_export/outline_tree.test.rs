use super::*;

fn item(level: u32, title: &str, page: usize) -> (u32, String, usize) {
    (level, title.to_string(), page)
}

fn titles(nodes: &[Node]) -> Vec<&str> {
    nodes.iter().map(|n| n.title.as_str()).collect()
}

// --- build_tree: nesting is decided entirely by heading level ---

#[test]
fn a_flat_list_of_one_level_is_all_roots() {
    let t = build_tree(&[item(1, "A", 0), item(1, "B", 1)]);
    assert_eq!(titles(&t), vec!["A", "B"]);
    assert!(t.iter().all(|n| n.children.is_empty()));
}

#[test]
fn a_deeper_level_nests_under_the_previous_heading() {
    let t = build_tree(&[item(1, "A", 0), item(2, "A.1", 0), item(2, "A.2", 1)]);
    assert_eq!(titles(&t), vec!["A"]);
    assert_eq!(titles(&t[0].children), vec!["A.1", "A.2"]);
}

#[test]
fn returning_to_a_shallower_level_starts_a_new_branch() {
    let t = build_tree(&[
        item(1, "A", 0),
        item(2, "A.1", 0),
        item(1, "B", 2),
        item(2, "B.1", 2),
    ]);
    assert_eq!(titles(&t), vec!["A", "B"]);
    assert_eq!(titles(&t[0].children), vec!["A.1"]);
    assert_eq!(titles(&t[1].children), vec!["B.1"]);
}

#[test]
fn a_skipped_level_attaches_to_the_nearest_ancestor() {
    // h1 -> h3 with no h2. Dropping the h3 would lose a real heading; real
    // documents skip levels all the time.
    let t = build_tree(&[item(1, "A", 0), item(3, "A.x", 1)]);
    assert_eq!(titles(&t), vec!["A"]);
    assert_eq!(titles(&t[0].children), vec!["A.x"]);
}

#[test]
fn a_document_that_opens_at_a_deep_level_still_produces_roots() {
    // Starting at h2 must not silently produce an empty outline.
    let t = build_tree(&[item(2, "only", 0), item(2, "also", 1)]);
    assert_eq!(titles(&t), vec!["only", "also"]);
}

#[test]
fn a_shallower_heading_after_a_deep_one_pops_all_the_way_out() {
    let t = build_tree(&[
        item(1, "A", 0),
        item(2, "A.1", 0),
        item(3, "A.1.a", 0),
        item(1, "B", 1),
    ]);
    assert_eq!(titles(&t), vec!["A", "B"]);
    assert_eq!(titles(&t[0].children[0].children), vec!["A.1.a"]);
    assert!(t[1].children.is_empty());
}

#[test]
fn an_empty_heading_list_yields_no_nodes() {
    assert!(build_tree(&[]).is_empty());
}

#[test]
fn page_numbers_survive_nesting() {
    let t = build_tree(&[item(1, "A", 3), item(2, "A.1", 7)]);
    assert_eq!(t[0].page, 3);
    assert_eq!(t[0].children[0].page, 7);
}

#[test]
fn an_absurd_heading_level_cannot_nest_without_bound() {
    // Levels arrive over IPC. `emit` recurses once per level of nesting, so an
    // unclamped level would nest that deep and blow the stack.
    let t = build_tree(&[
        (1, "root".into(), 0),
        (9_999, "deep".into(), 0),
        (u32::MAX, "deeper".into(), 0),
    ]);
    // Everything below h6 collapses to h6, so both deep headings land at the
    // same depth and become SIBLINGS — not an ever-deepening chain.
    assert_eq!(t.len(), 1);
    assert_eq!(titles(&t[0].children), vec!["deep", "deeper"]);
    assert!(t[0].children.iter().all(|n| n.children.is_empty()));
}

#[test]
fn a_zero_level_is_clamped_rather_than_underflowing() {
    let t = build_tree(&[(0, "a".into(), 0), (0, "b".into(), 1)]);
    assert_eq!(t.len(), 2, "level 0 clamps to 1 and stays a root");
}
