// WI-AL3.1 (WI-AL3.1a) — comment anchors: a quote with 32-unit context and a heading path, resolved by context, then heading path, then anywhere (one candidate resolves, several are ambiguous, none is orphaned; the offset hint breaks ties only on the creation revision); UTF-16 offsets that never split a surrogate pair; CommonMark ATX and setext headings outside code and containers; selections that map exactly or widen visibly to whole blocks; quotes over 4096 UTF-8 bytes refused as COMMENT_ANCHOR_TOO_LONG; every spike fixture and resolver scenario from the shared golden file; and no path from an anchor into the revert gate
//! Comment anchor creation and resolution against the shared goldens
//! (`src/test/fixtures/agentJournal/commentAnchorGoldens.json`, whose heading
//! fields the TypeScript test holds to the production parser).

use serde::Deserialize;

use super::{
    admit_quote, create_anchor, headings, resolve, AnchorError, AnchorSelection, CreatedAnchor,
    Mapping, OffsetHint, Resolution, SelectionPrecision, StoredAnchor, Tier,
};
use crate::agent_journal::errors::TxnError;
use crate::agent_journal::ids::RevisionId;
use crate::agent_journal::refusal::refusal;
use crate::command_error::ErrorCode;

const GOLDENS: &str =
    include_str!("../../../src/test/fixtures/agentJournal/commentAnchorGoldens.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Goldens {
    context_units: usize,
    max_quote_utf8_bytes: usize,
    fixtures: Vec<Fixture>,
    scenarios: Vec<Scenario>,
    heading_cases: Vec<HeadingCase>,
    block_cases: Vec<BlockCase>,
}

#[derive(Deserialize)]
struct Selection {
    start: u64,
    end: u64,
    #[serde(default)]
    precision: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expect {
    outcome: String,
    start: u64,
    end: u64,
    quote: String,
    prefix: String,
    suffix: String,
    heading_path: Vec<String>,
    quote_utf8_bytes: usize,
    admission: String,
    self_ambiguous: bool,
}

#[derive(Deserialize)]
struct Fixture {
    id: String,
    markdown: String,
    selection: Selection,
    expect: Expect,
}

#[derive(Deserialize)]
struct ScenarioExpect {
    status: String,
    tier: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    id: String,
    markdown: String,
    selection: Selection,
    heading_path: Vec<String>,
    edited: String,
    expect: ScenarioExpect,
    hint_is_candidate: bool,
}

#[derive(Deserialize, Debug, PartialEq)]
struct GoldenHeading {
    depth: u8,
    offset: u64,
    text: String,
}

#[derive(Deserialize)]
struct HeadingCase {
    id: String,
    markdown: String,
    headings: Vec<GoldenHeading>,
}

#[derive(Deserialize)]
struct BlockCase {
    id: String,
    markdown: String,
    blocks: Vec<(u64, u64)>,
}

fn goldens() -> Goldens {
    serde_json::from_str(GOLDENS).expect("the comment anchor goldens parse")
}

fn exact(start: u64, end: u64) -> AnchorSelection {
    AnchorSelection {
        start,
        end,
        precision: SelectionPrecision::Exact,
    }
}

fn approximate(start: u64, end: u64) -> AnchorSelection {
    AnchorSelection {
        start,
        end,
        precision: SelectionPrecision::Approximate,
    }
}

/// UTF-16 offset of the first `needle` in `text`.
fn at(text: &str, needle: &str) -> u64 {
    let byte = text.find(needle).expect("needle present");
    text[..byte].encode_utf16().count() as u64
}

fn created(text: &str, selection: AnchorSelection, revision: RevisionId) -> CreatedAnchor {
    create_anchor(text, &selection, revision).expect("anchor created")
}

fn stored(quote: &str, prefix: &str, suffix: &str, path: &[&str]) -> StoredAnchor {
    StoredAnchor {
        quote: quote.into(),
        prefix: prefix.into(),
        suffix: suffix.into(),
        heading_path: path.iter().map(|s| s.to_string()).collect(),
        hint: None,
    }
}

const DUP_BEFORE: &str = "# Notes\n\nKeep the passage here.\n";
const DUP_AFTER: &str = "# Notes\n\nKeep the passage there.\n\nMove the passage away.\n";

#[test]
fn a_duplicated_passage_resolves_ambiguous() {
    let rev = RevisionId::new();
    let anchor = created(DUP_BEFORE, exact(14, 25), rev).anchor;
    assert_eq!(anchor.quote, "the passage");
    let first = at(DUP_AFTER, "the passage");
    let second = at(DUP_AFTER, "the passage away");
    let r = resolve(DUP_AFTER, &anchor, Some(RevisionId::new()));
    assert_eq!(
        r,
        Resolution::Ambiguous {
            tier: Tier::HeadingPath,
            candidates: vec![first, second]
        }
    );
    // The creation offset is a candidate, but this is a later revision: still ambiguous.
    assert_eq!(anchor.hint.as_ref().map(|h| h.offset), Some(first));
    assert!(matches!(
        resolve(DUP_AFTER, &anchor, None),
        Resolution::Ambiguous { .. }
    ));
}

#[test]
fn a_deleted_passage_resolves_orphaned() {
    let rev = RevisionId::new();
    let anchor = created(DUP_BEFORE, exact(14, 25), rev).anchor;
    let r = resolve(
        "# Notes\n\nKeep it short.\n",
        &anchor,
        Some(RevisionId::new()),
    );
    assert_eq!(r, Resolution::Orphaned);
    assert_eq!(resolve("", &anchor, Some(rev)), Resolution::Orphaned);
}

const RENAMED_BEFORE: &str =
    "# Old title\n\nA first paragraph that is long enough to keep the heading out of context.\n\nthe annotated words stay put\n";
const RENAMED_AFTER: &str =
    "# A completely new title\n\nA first paragraph that is long enough to keep the heading out of context.\n\nthe annotated words stay put\n";

#[test]
fn a_renamed_heading_still_resolves_by_context() {
    let start = at(RENAMED_BEFORE, "annotated words");
    let anchor = created(RENAMED_BEFORE, exact(start, start + 15), RevisionId::new()).anchor;
    assert_eq!(anchor.heading_path, vec!["Old title".to_string()]);
    let moved = at(RENAMED_AFTER, "annotated words");
    let r = resolve(RENAMED_AFTER, &anchor, Some(RevisionId::new()));
    assert!(
        matches!(r, Resolution::Resolved { tier: Tier::Context, start, end, by_hint: false } if start == moved && end == moved + 15)
    );
}

const ACROSS: &str = "# One\n\nalpha text here\n\n## Two\n\nbeta text here\n";

#[test]
fn a_selection_across_headings_maps_exactly_or_widens_visibly() {
    let rev = RevisionId::new();
    let (from, to) = (at(ACROSS, "text here"), at(ACROSS, "beta") + 4);
    let precise = created(ACROSS, exact(from, to), rev);
    assert_eq!(precise.mapping, Mapping::Exact);
    assert_eq!(precise.anchor.quote, "text here\n\n## Two\n\nbeta");
    assert_eq!(precise.anchor.heading_path, vec!["One".to_string()]);
    assert!(matches!(
        resolve(ACROSS, &precise.anchor, Some(rev)),
        Resolution::Resolved {
            tier: Tier::Context,
            ..
        }
    ));

    // The editor could not map the bounds exactly: the anchor covers whole blocks and says so.
    let wide = created(ACROSS, approximate(from + 2, to - 1), rev);
    assert_eq!(wide.mapping, Mapping::Widened);
    assert_eq!(
        wide.anchor.quote,
        "alpha text here\n\n## Two\n\nbeta text here"
    );
    assert_eq!(
        (wide.start, wide.end),
        (at(ACROSS, "alpha"), at(ACROSS, "beta") + 14)
    );
    assert_eq!(wide.anchor.prefix, "# One\n\n");
    assert_eq!(wide.anchor.suffix, "\n");
}

const UNICODE: &str = "# 标题\n\n中文 😀 שלום target end\n";

#[test]
fn cjk_emoji_and_rtl_offsets_are_exact_utf16_units() {
    let rev = RevisionId::new();
    let a = created(UNICODE, exact(17, 23), rev);
    assert_eq!(a.anchor.quote, "target");
    assert_eq!(a.start, 17);
    assert_eq!(a.anchor.prefix.encode_utf16().count(), 17);
    assert_eq!(a.anchor.heading_path, vec!["标题".to_string()]);
    // A bound inside the emoji's surrogate pair moves outward, never splits it.
    let split = created(UNICODE, exact(10, 23), rev);
    assert_eq!(split.start, 9);
    assert_eq!(split.anchor.quote, "😀 שלום target");
    // An edit before the quote shifts it by exactly the inserted UTF-16 units.
    let edited = "# 标题\n\n中文 🎉😀 שלום target end\n";
    let r = resolve(edited, &a.anchor, Some(RevisionId::new()));
    assert!(matches!(
        r,
        Resolution::Resolved {
            start: 19,
            end: 25,
            ..
        }
    ));
    assert_eq!(at(edited, "target"), 19);
    // Context stops one unit short rather than split a pair at its far end.
    let pairs = "😀".repeat(20);
    let text = format!("{pairs}x{pairs}");
    let mid = created(&text, exact(40, 41), rev);
    assert_eq!(mid.anchor.prefix.encode_utf16().count(), 32);
    let odd = created(&text, exact(39, 41), rev);
    assert_eq!(odd.start, 38);
    assert_eq!(odd.anchor.suffix.encode_utf16().count(), 32);
    let skew = format!("ab{pairs}");
    let edge = created(&skew, exact(0, 1), rev);
    assert_eq!(edge.anchor.suffix.encode_utf16().count(), 31);
    let tail = format!("{pairs}zz");
    let edge = created(&tail, exact(41, 42), rev);
    assert_eq!(edge.anchor.prefix.encode_utf16().count(), 31);
}

#[test]
fn a_4096_byte_quote_is_accepted_and_4097_is_refused() {
    let rev = RevisionId::new();
    // 1,364 three-byte characters plus ASCII: 4_092 bytes, then 4 or 5 more.
    let text = format!("x {}abcde y\n", "中".repeat(1364));
    let accepted = created(&text, exact(2, 2 + 1364 + 4), rev);
    assert_eq!(accepted.anchor.quote.len(), 4_096);
    let refused = create_anchor(&text, &exact(2, 2 + 1364 + 5), rev);
    assert_eq!(
        refused.unwrap_err(),
        AnchorError::AnchorTooLong {
            bytes: 4_097,
            limit: 4_096
        }
    );
    assert_eq!(admit_quote(&"a".repeat(4_096)), Ok(4_096));
    let err = admit_quote(&"a".repeat(4_097)).unwrap_err();
    assert_eq!(err.code(), "COMMENT_ANCHOR_TOO_LONG");

    // Widening past the bound is refused the same way, never truncated.
    let big = format!("intro\n\n{}\n", "word ".repeat(1000));
    let widened = create_anchor(&big, &approximate(10, 12), rev);
    assert!(
        matches!(widened, Err(AnchorError::AnchorTooLong { bytes, limit: 4_096 }) if bytes > 4_096)
    );

    // On the wire: an invalid-input command error naming the journal code and the sizes.
    let wire = refusal(&TxnError::from(err));
    assert_eq!(wire.code(), ErrorCode::InvalidInput);
    let detail = wire.detail().expect("detail");
    assert_eq!(detail["journalCode"], "COMMENT_ANCHOR_TOO_LONG");
    assert_eq!(
        (detail["bytes"].as_u64(), detail["limit"].as_u64()),
        (Some(4_097), Some(4_096))
    );
}

fn mapping_name(m: Mapping) -> &'static str {
    match m {
        Mapping::Exact => "exact",
        Mapping::Widened => "widened",
    }
}

#[test]
fn every_spike_fixture_maps_exactly_or_widens_visibly() {
    let g = goldens();
    assert_eq!(
        (g.context_units, g.max_quote_utf8_bytes),
        (super::CONTEXT_UNITS, super::MAX_QUOTE_UTF8_BYTES)
    );
    assert_eq!(g.fixtures.len(), 47);
    let mut seen = (0, 0);
    for f in &g.fixtures {
        let e = &f.expect;
        let precision = match f.selection.precision.as_deref() {
            Some("exact") => SelectionPrecision::Exact,
            Some("approximate") => SelectionPrecision::Approximate,
            other => panic!("{}: unknown precision {other:?}", f.id),
        };
        let rev = RevisionId::new();
        let sel = AnchorSelection {
            start: f.selection.start,
            end: f.selection.end,
            precision,
        };
        let got = create_anchor(&f.markdown, &sel, rev);
        if e.admission == "refused" {
            let want = AnchorError::AnchorTooLong {
                bytes: e.quote_utf8_bytes,
                limit: 4096,
            };
            assert_eq!(got.unwrap_err(), want, "{}", f.id);
            continue;
        }
        let a = got.unwrap_or_else(|err| panic!("{}: {err:?}", f.id));
        match a.mapping {
            Mapping::Exact => seen.0 += 1,
            Mapping::Widened => seen.1 += 1,
        }
        assert_eq!(mapping_name(a.mapping), e.outcome, "{}", f.id);
        assert_eq!((a.start, a.end), (e.start, e.end), "{}", f.id);
        assert_eq!(a.anchor.quote, e.quote, "{}", f.id);
        assert_eq!(a.anchor.prefix, e.prefix, "{}", f.id);
        assert_eq!(a.anchor.suffix, e.suffix, "{}", f.id);
        assert_eq!(a.anchor.heading_path, e.heading_path, "{}", f.id);
        assert_eq!(a.anchor.quote.len(), e.quote_utf8_bytes, "{}", f.id);
        // On its own revision the anchor finds itself; elsewhere a twin makes it ambiguous.
        let own = resolve(&f.markdown, &a.anchor, Some(rev));
        assert!(
            matches!(own, Resolution::Resolved { start, .. } if start == e.start),
            "{}: {own:?}",
            f.id
        );
        let later = resolve(&f.markdown, &a.anchor, Some(RevisionId::new()));
        assert_eq!(
            matches!(later, Resolution::Ambiguous { .. }),
            e.self_ambiguous,
            "{}: {later:?}",
            f.id
        );
    }
    assert!(
        seen.0 > 0 && seen.1 > 0,
        "both exact and widened fixtures ran: {seen:?}"
    );
}

fn tier_number(t: Tier) -> u8 {
    match t {
        Tier::Context => 1,
        Tier::HeadingPath => 2,
        Tier::Anywhere => 3,
    }
}

#[test]
fn every_resolver_scenario_resolves_as_the_spike_decided() {
    let g = goldens();
    assert_eq!(g.scenarios.len(), 14);
    for s in &g.scenarios {
        let rev = RevisionId::new();
        let a = created(&s.markdown, exact(s.selection.start, s.selection.end), rev).anchor;
        assert_eq!(a.heading_path, s.heading_path, "{}", s.id);
        let hint = a.hint.as_ref().expect("hint").offset;
        let r = resolve(&s.edited, &a, Some(RevisionId::new()));
        let (status, tier) = match &r {
            Resolution::Resolved { tier, .. } => ("resolved", Some(tier_number(*tier))),
            Resolution::Ambiguous { tier, candidates } => {
                assert_eq!(candidates.contains(&hint), s.hint_is_candidate, "{}", s.id);
                ("ambiguous", Some(tier_number(*tier)))
            }
            Resolution::Orphaned => ("orphaned", None),
        };
        assert_eq!(
            (status, tier),
            (s.expect.status.as_str(), s.expect.tier),
            "{}: {r:?}",
            s.id
        );
    }
}

#[test]
fn the_offset_hint_breaks_a_tie_only_on_the_creation_revision() {
    let text = "same words\n\nsame words\n";
    let rev = RevisionId::new();
    let mut a = stored("same words", "", "", &[]);
    a.hint = Some(OffsetHint {
        revision: rev,
        offset: 12,
    });
    assert_eq!(
        resolve(text, &a, Some(rev)),
        Resolution::Resolved {
            tier: Tier::Context,
            start: 12,
            end: 22,
            by_hint: true
        }
    );
    assert_eq!(
        resolve(text, &a, Some(RevisionId::new())),
        Resolution::Ambiguous {
            tier: Tier::Context,
            candidates: vec![0, 12]
        }
    );
    assert_eq!(
        resolve(text, &a, None),
        Resolution::Ambiguous {
            tier: Tier::Context,
            candidates: vec![0, 12]
        }
    );
    // A hint that is not a candidate is never used as "nearest".
    let mut off = a.clone();
    off.hint.as_mut().expect("hint").offset = 11;
    assert!(matches!(
        resolve(text, &off, Some(rev)),
        Resolution::Ambiguous { .. }
    ));
}

#[test]
fn overlapping_occurrences_are_all_candidates() {
    let a = stored("aa", "", "", &[]);
    assert_eq!(
        resolve("aaa", &a, None),
        Resolution::Ambiguous {
            tier: Tier::Context,
            candidates: vec![0, 1]
        }
    );
    let lone = stored("b", "zzz", "", &["Elsewhere"]);
    assert_eq!(
        resolve("ab", &lone, None),
        Resolution::Resolved {
            tier: Tier::Anywhere,
            start: 1,
            end: 2,
            by_hint: false
        }
    );
}

#[test]
fn the_heading_goldens_match_the_rust_heading_scanner() {
    let g = goldens();
    assert!(g.heading_cases.len() >= 40);
    let mismatches: Vec<String> = g
        .heading_cases
        .iter()
        .filter_map(|c| {
            let got: Vec<GoldenHeading> = headings(&c.markdown)
                .into_iter()
                .map(|h| GoldenHeading {
                    depth: h.depth,
                    offset: h.offset,
                    text: h.text,
                })
                .collect();
            (got != c.headings).then(|| {
                format!(
                    "{}: {:?}\n  rust: {got:?}\n  parser: {:?}",
                    c.id, c.markdown, c.headings
                )
            })
        })
        .collect();
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn the_block_goldens_match_the_rust_block_scanner() {
    // Root block ranges are what a widened anchor covers.
    let g = goldens();
    assert!(g.block_cases.len() >= 30);
    for c in &g.block_cases {
        assert_eq!(
            super::outline::outline(&c.markdown).blocks,
            c.blocks,
            "{}: {:?}",
            c.id,
            c.markdown
        );
    }
}

fn heading_texts(md: &str) -> Vec<(u8, String)> {
    headings(md)
        .into_iter()
        .map(|h| (h.depth, h.text))
        .collect()
}

#[test]
fn atx_headings_follow_commonmark_closing_sequence_rules() {
    assert_eq!(heading_texts("# C#\n"), vec![(1, "C#".into())]);
    assert_eq!(heading_texts("# C #\n"), vec![(1, "C".into())]);
    assert_eq!(heading_texts("# C \\#\n"), vec![(1, "C \\#".into())]);
    assert_eq!(
        heading_texts("# A\t#\t\n## B #\t##\n### C\t###\n"),
        vec![(1, "A".into()), (2, "B #".into()), (3, "C".into())]
    );
    assert_eq!(
        heading_texts("# Notes\n\n# Notes\n"),
        vec![(1, "Notes".into()), (1, "Notes".into())]
    );
    assert_eq!(
        heading_texts("# 标题 😀\n## עברית\n"),
        vec![(1, "标题 😀".into()), (2, "עברית".into())]
    );
}

#[test]
fn heading_like_lines_in_code_and_containers_are_not_headings() {
    assert_eq!(heading_texts("```\n# fenced\n```\n"), vec![]);
    assert_eq!(heading_texts("    # indented\n"), vec![]);
    assert_eq!(heading_texts("> # quoted\n"), vec![]);
    assert_eq!(heading_texts("- # listed\n\n  # still listed\n"), vec![]);
    assert_eq!(
        heading_texts("```\nFake\n===\n```\n\nReal\n===\n"),
        vec![(1, "Real".into())]
    );
    assert_eq!(heading_texts("para\n\n---\n"), vec![]);
    assert_eq!(heading_texts("Title\n-----\n"), vec![(2, "Title".into())]);
}

#[test]
fn an_invalid_selection_is_refused() {
    let rev = RevisionId::new();
    let past = create_anchor("abc", &exact(1, 9), rev);
    assert!(matches!(past, Err(AnchorError::InvalidSelection(_))));
    let reversed = create_anchor("abc", &exact(2, 1), rev);
    assert!(matches!(reversed, Err(AnchorError::InvalidSelection(_))));
    let empty_doc = create_anchor("", &exact(0, 0), rev);
    assert!(matches!(empty_doc, Err(AnchorError::InvalidSelection(_))));
    let wire = refusal(&TxnError::from(AnchorError::InvalidSelection("x".into())));
    assert_eq!(
        wire.detail().expect("detail")["journalCode"],
        "INVALID_REQUEST"
    );
}

#[test]
fn a_collapsed_or_blank_selection_widens_to_the_nearest_block() {
    let rev = RevisionId::new();
    let text = "first para\n\n\n\nsecond para\n";
    let caret = created(text, exact(3, 3), rev);
    assert_eq!(
        (caret.mapping, caret.anchor.quote.as_str()),
        (Mapping::Widened, "first para")
    );
    let gap = created(text, approximate(12, 12), rev);
    assert_eq!(gap.anchor.quote, "second para");
    let after = created(text, approximate(26, 26), rev);
    assert_eq!(after.anchor.quote, "second para");
}

#[test]
fn an_anchor_never_reaches_the_revert_gate() {
    // An anchor locates a comment; it is never evidence that a span may be reverted.
    for (name, source) in [
        ("revert_gate.rs", include_str!("revert_gate.rs")),
        ("writer_revert.rs", include_str!("writer_revert.rs")),
    ] {
        assert!(
            !source.contains("comment_anchor"),
            "{name} must not use comment anchors"
        );
    }
    let own = include_str!("comment_anchor.rs");
    assert!(!own.contains("revert_gate") && !own.contains("writer_revert"));
}
