// WI-AL2.1b — R24 fuzz of declared-script writes: random whole-text agent writes (one or two runs over a small alphabet biased to long runs of one letter, with a supplementary-plane character) interleaved with certified human edits; every write is certified, every run is its own hunk at the span its script put it, a revert the writer plans equals the exact revert under every reading of the later scripts (zero wrong, ambiguous ones refused, some of them two or more units from the run that made them so), some reverts succeed, and a refused revert leaves the journal unchanged
//! The oracle tracks every character as a token with the run that
//! inserted it and the run that deleted it. A hunk's exact revert is the
//! visible text with its run's insertions hidden and its deletions shown.
//! A later script that rotates through equal text ("aZ" appended after
//! "aZ" is also "Za" inserted after the "a") has several readings with
//! the same text but different token owners; the oracle keeps one world
//! per reading, so an older hunk whose revert differs between worlds is
//! ambiguous and must be refused. A hunk's own script is exact by
//! contract: it is judged only in the worlds that read it as declared.

use super::super::support::*;
use crate::agent_journal::doc_registry::DocRegistry;
use crate::agent_journal::ids::{DocId, HunkId};
use crate::agent_journal::revert_gate::RevertDecision;
use crate::agent_journal::review::HunkState;
use crate::agent_journal::test_review_helpers::revert;
use crate::agent_journal::test_support::*;
use crate::agent_journal::writer::Writer;
use std::collections::{BTreeSet, HashMap};

const ALPHABET: [char; 4] = ['a', 'Z', '\n', '😀'];
const SEEDS: u64 = 64;
const STEPS: usize = 16;
/// Worlds kept per seed; dropping one can only miss a wrong revert, never invent one.
const MAX_WORLDS: usize = 256;
/// The owner of the base text and of every human edit.
const HUMAN: usize = 0;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    /// Up to `max` characters, two in three of them "a", so long runs of
    /// one letter give a run many places to rotate to.
    fn text(&mut self, max: usize) -> Vec<char> {
        (0..self.below(max + 1))
            .map(|_| match self.below(3) {
                0 => ALPHABET[self.below(ALPHABET.len())],
                _ => 'a',
            })
            .collect()
    }
}

#[derive(Clone)]
struct Tok {
    ch: char,
    ins: usize,
    del: Option<usize>,
}

/// One replacement at a visible character index: `delete` characters become `insert`.
#[derive(Clone)]
struct Run {
    at: usize,
    delete: usize,
    insert: Vec<char>,
}

/// One reading of every script so far: the tokens, and the runs of every script read other than declared.
#[derive(Clone, Default)]
struct World {
    toks: Vec<Tok>,
    rotated: BTreeSet<usize>,
}

impl World {
    fn shown(&self, reverted: Option<usize>) -> String {
        self.toks
            .iter()
            .filter(|t| match reverted {
                Some(k) if t.ins == k => false,
                Some(k) if t.del == Some(k) => true,
                _ => t.del.is_none(),
            })
            .map(|t| t.ch)
            .collect()
    }
    fn visible(&self) -> Vec<usize> {
        (0..self.toks.len())
            .filter(|&i| self.toks[i].del.is_none())
            .collect()
    }
    /// Apply `run` as owner `k`, returning it as an `Edit` in UTF-16 units.
    fn apply(&mut self, run: &Run, k: usize) -> Edit {
        let vis = self.visible();
        let text = |r: &[usize]| r.iter().map(|&i| self.toks[i].ch).collect::<String>();
        let (before, deleted) = (
            text(&vis[..run.at]),
            text(&vis[run.at..run.at + run.delete]),
        );
        for &i in &vis[run.at..run.at + run.delete] {
            self.toks[i].del = Some(k);
        }
        // New text goes right before the next visible character, its own
        // deletion included: a run's span holds its deletion and insertion
        // together, and an older deletion before it stays before it (an
        // empty span is a point that keeps its place at an insertion).
        let pos = vis.get(run.at).copied().unwrap_or(self.toks.len());
        let fresh = run.insert.iter().map(|&ch| Tok {
            ch,
            ins: k,
            del: None,
        });
        self.toks.splice(pos..pos, fresh);
        Edit {
            at: units(&before),
            delete: units(&deleted),
            insert: units(&run.insert.iter().collect::<String>()),
        }
    }
    /// Run `k`'s span in the current text, `[from, to)` in UTF-16 units.
    fn span(&self, k: usize) -> (u64, u64) {
        let first = self
            .toks
            .iter()
            .position(|t| t.ins == k || t.del == Some(k))
            .expect("run has tokens");
        let live = |t: &&Tok| t.del.is_none();
        let from = units(
            &self.toks[..first]
                .iter()
                .filter(live)
                .map(|t| t.ch)
                .collect::<String>(),
        );
        let len = units(
            &self
                .toks
                .iter()
                .filter(|t| t.ins == k)
                .map(|t| t.ch)
                .collect::<String>(),
        );
        (from, from + len)
    }
}

fn units(s: &str) -> u64 {
    s.encode_utf16().count() as u64
}

/// `run` with the prefix and suffix its deletion and insertion share
/// trimmed, as a canonical diff states it; `None` when nothing is left.
fn trimmed(pre: &[char], mut run: Run) -> Option<Run> {
    while run.delete > 0 && !run.insert.is_empty() && pre[run.at] == run.insert[0] {
        (run.at, run.delete) = (run.at + 1, run.delete - 1);
        run.insert.remove(0);
    }
    while run.delete > 0 && run.insert.last() == Some(&pre[run.at + run.delete - 1]) {
        run.delete -= 1;
        run.insert.pop();
    }
    (run.delete > 0 || !run.insert.is_empty()).then_some(run)
}

/// One or two runs over `pre`, right to left with a character between
/// them so each stays its own run and keeps its index.
fn runs(rng: &mut Rng, pre: &[char]) -> Vec<Run> {
    let mut out = Vec::new();
    let mut limit = pre.len();
    for _ in 0..1 + rng.below(2) {
        let at = rng.below(limit + 1);
        let delete = rng.below((limit - at).min(3) + 1);
        let raw = Run {
            at,
            delete,
            insert: rng.text(3),
        };
        if let Some(run) = trimmed(pre, raw) {
            limit = run.at;
            out.push(run);
        }
        if limit < 2 {
            break;
        }
        limit -= 2;
    }
    out
}

/// Every reading of a trimmed `run` within `[lo, hi]` of `pre`: a pure
/// insertion or deletion shifted through the equal text beside it; the
/// declared reading first. A trimmed replacement has only its own.
fn readings(pre: &[char], run: &Run, lo: usize, hi: usize) -> Vec<Run> {
    let mut out = vec![run.clone()];
    if run.delete > 0 && !run.insert.is_empty() {
        return out;
    }
    for step in [-1i64, 1] {
        let mut r = run.clone();
        loop {
            let next = if run.delete == 0 {
                match step {
                    -1 if r.at > lo && Some(&pre[r.at - 1]) == r.insert.last() => {
                        let mut ins = vec![pre[r.at - 1]];
                        ins.extend_from_slice(&r.insert[..r.insert.len() - 1]);
                        Run {
                            at: r.at - 1,
                            delete: 0,
                            insert: ins,
                        }
                    }
                    1 if r.at < hi && pre[r.at] == r.insert[0] => {
                        let mut ins = r.insert[1..].to_vec();
                        ins.push(pre[r.at]);
                        Run {
                            at: r.at + 1,
                            delete: 0,
                            insert: ins,
                        }
                    }
                    _ => break,
                }
            } else {
                match step {
                    -1 if r.at > lo && pre[r.at - 1] == pre[r.at + r.delete - 1] => Run {
                        at: r.at - 1,
                        ..r.clone()
                    },
                    1 if r.at + r.delete < hi && pre[r.at] == pre[r.at + r.delete] => Run {
                        at: r.at + 1,
                        ..r.clone()
                    },
                    _ => break,
                }
            };
            out.push(next.clone());
            r = next;
        }
    }
    out
}

#[derive(Default)]
struct Tally {
    certified_writes: u64,
    successes: u64,
    refusals: u64,
    /// Hunks whose revert differed between worlds.
    ambiguous: u64,
    /// Hunks a write made ambiguous at two or more units from every run of
    /// that write: a rotation set cut short misses them.
    far_ambiguous: u64,
    worlds_dropped: u64,
    refused_commits: u64,
    wrong: Vec<String>,
}

fn live_pending(w: &Writer, doc: DocId, owner: &HashMap<HunkId, usize>) -> Vec<(HunkId, usize)> {
    let s = w.snapshot().state;
    let mut ids: Vec<(HunkId, usize)> = s.docs[&doc]
        .hunks
        .iter()
        .filter(|(id, h)| h.state == HunkState::Pending && owner.contains_key(*id))
        .map(|(id, _)| (id.clone(), owner[id]))
        .collect();
    ids.sort_by(|a, b| a.0 .0.cmp(&b.0 .0));
    ids
}

fn applies(w: &Writer, doc: DocId, id: &HunkId) -> Option<String> {
    match w.plan_revert(doc, id).map(|p| p.decision) {
        Ok(RevertDecision::Apply { postimage, .. }) => Some(postimage),
        _ => None,
    }
}

/// Plan every pending hunk's revert against every world that reads its
/// run as declared; returns the owners whose exact revert is ambiguous.
fn check_reverts(
    w: &Writer,
    doc: DocId,
    worlds: &[World],
    owner: &HashMap<HunkId, usize>,
    seed: u64,
    t: &mut Tally,
) -> BTreeSet<usize> {
    let mut ambiguous = BTreeSet::new();
    for (id, k) in live_pending(w, doc, owner) {
        let wants: BTreeSet<String> = worlds
            .iter()
            .filter(|x| !x.rotated.contains(&k))
            .map(|x| x.shown(Some(k)))
            .collect();
        if wants.len() > 1 {
            t.ambiguous += 1;
            ambiguous.insert(k);
        }
        match applies(w, doc, &id) {
            Some(got) if wants.len() == 1 && wants.contains(&got) => t.successes += 1,
            Some(got) => t.wrong.push(format!(
                "seed {seed}: head {:?}, got {got:?}, exact {wants:?}",
                worlds[0].shown(None)
            )),
            None => t.refusals += 1,
        }
    }
    ambiguous
}

/// Units between the span `(from, to)` and the nearest of `rs` in `pre`.
fn distance(pre: &[char], rs: &[Run], (from, to): (u64, u64)) -> u64 {
    let at = |i: usize| units(&pre[..i].iter().collect::<String>());
    rs.iter()
        .map(|r| {
            let (r0, r1) = (at(r.at), at(r.at + r.delete));
            r0.saturating_sub(to).max(from.saturating_sub(r1))
        })
        .min()
        .unwrap_or(0)
}

/// A refused revert, attempted for real, changes nothing.
fn refused_revert_changes_nothing(
    w: &Writer,
    doc: DocId,
    owner: &HashMap<HunkId, usize>,
    t: &mut Tally,
) {
    let Some((id, _)) = live_pending(w, doc, owner)
        .into_iter()
        .find(|(id, _)| applies(w, doc, id).is_none())
    else {
        return;
    };
    let (before, text) = (w.snapshot(), head_text(w, doc));
    assert!(
        revert(w, doc, &id, &text, &text).is_err(),
        "a refused revert committed"
    );
    assert_eq!(w.snapshot(), before, "a refused revert changed the journal");
    assert_eq!(head_text(w, doc), text);
    t.refused_commits += 1;
}

/// Every world after the declared runs `rs` (owners `ks`), each run in each of its readings.
fn branch(worlds: Vec<World>, pre: &[char], rs: &[Run], ks: &[usize], t: &mut Tally) -> Vec<World> {
    let mut out = worlds;
    for (i, (run, &k)) in rs.iter().zip(ks).enumerate() {
        // Runs are right to left: the one after it in the text is `i - 1`.
        let lo = rs.get(i + 1).map_or(0, |l| l.at + l.delete);
        let hi = i.checked_sub(1).map_or(pre.len(), |r| rs[r].at);
        let mut next = Vec::new();
        for world in &out {
            for (j, reading) in readings(pre, run, lo, hi).iter().enumerate() {
                let mut x = world.clone();
                x.apply(reading, k);
                if j > 0 {
                    // The whole script is exact by contract, so a reading
                    // that moves one run is not one its siblings are judged in.
                    x.rotated.extend(ks.iter().copied());
                }
                next.push(x);
            }
        }
        t.worlds_dropped += next.len().saturating_sub(MAX_WORLDS) as u64;
        next.truncate(MAX_WORLDS);
        out = next;
    }
    out
}

fn one_seed(seed: u64, t: &mut Tally) {
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    let docs = DocRegistry::default();
    let doc = docs.resolve(KEY).unwrap();
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let base: String = std::iter::once('p')
        .chain(rng.text(8))
        .chain(std::iter::once('q'))
        .collect();
    let toks = base
        .chars()
        .map(|ch| Tok {
            ch,
            ins: HUMAN,
            del: None,
        })
        .collect();
    let mut worlds = vec![World {
        toks,
        rotated: BTreeSet::new(),
    }];
    human_save(&w, doc, &base);
    let (mut owner, mut owners) = (HashMap::new(), 0);
    let mut seen_ambiguous = BTreeSet::new();
    for _ in 0..STEPS {
        let pre_chars: Vec<char> = worlds[0].shown(None).chars().collect();
        let pre: String = pre_chars.iter().collect();
        let rs = runs(&mut rng, &pre_chars);
        if rs.is_empty() {
            continue;
        }
        if rng.below(3) == 0 {
            // A certified human edit of one run, the same in every world.
            let edits: Vec<Edit> = worlds.iter_mut().map(|x| x.apply(&rs[0], HUMAN)).collect();
            human_edit(&w, doc, &worlds[0].shown(None), &edits[..1]);
            seen_ambiguous.extend(check_reverts(&w, doc, &worlds, &owner, seed, t));
            continue;
        }
        let ks: Vec<usize> = rs
            .iter()
            .map(|_| {
                owners += 1;
                owners
            })
            .collect();
        // The declared script, read as declared, comes first.
        let mut declared = worlds[0].clone();
        let edits: Vec<Edit> = rs
            .iter()
            .zip(&ks)
            .map(|(r, &k)| declared.apply(r, k))
            .collect();
        let post = declared.shown(None);
        let spans: HashMap<usize, (u64, u64)> =
            owner.values().map(|&k| (k, worlds[0].span(k))).collect();
        worlds = branch(worlds, &pre_chars, &rs, &ks, t);
        assert!(
            worlds.iter().all(|x| x.shown(None) == post),
            "seed {seed}: a reading changed the text"
        );
        let before = hunk_ids(&w, doc);
        let req = Req {
            certificate: Some(cert(&pre, &post, &edits)),
            tool: "document.write",
            ..Req::new(w.head(doc), &pre)
        };
        let p = prepare(&w, &docs, req)
            .unwrap_or_else(|e| panic!("seed {seed}: prepare {pre:?} → {post:?}: {e}"));
        let out = commit(&w, p.txn, &post, None).unwrap();
        assert!(
            out.certified,
            "seed {seed}: {pre:?} → {post:?} not certified: {out:?}"
        );
        t.certified_writes += 1;
        let s = w.snapshot().state;
        let fresh: Vec<HunkId> = hunk_ids(&w, doc)
            .into_iter()
            .filter(|h| !before.contains(h))
            .collect();
        assert_eq!(
            fresh.len(),
            ks.len(),
            "seed {seed}: {pre:?} → {post:?}: one hunk per run"
        );
        for &k in &ks {
            let (from, to) = declared.span(k);
            let id = fresh
                .iter()
                .find(|id| {
                    let r = s.docs[&doc].hunks[*id].hunk.target_range;
                    (r.start, r.end) == (from, to)
                })
                .unwrap_or_else(|| panic!("seed {seed}: {pre:?} → {post:?}: no hunk at the script's span {from}..{to}"));
            owner.insert(id.clone(), k);
        }
        for k in check_reverts(&w, doc, &worlds, &owner, seed, t) {
            if seen_ambiguous.insert(k)
                && spans
                    .get(&k)
                    .is_some_and(|&s| distance(&pre_chars, &rs, s) >= 2)
            {
                t.far_ambiguous += 1;
            }
        }
    }
    refused_revert_changes_nothing(&w, doc, &owner, t);
}

#[test]
fn declared_script_writes_revert_exactly_or_refuse_without_changing_anything() {
    let mut t = Tally::default();
    for seed in 1..=SEEDS {
        one_seed(seed, &mut t);
    }
    assert!(
        t.wrong.is_empty(),
        "{} wrong reverts:\n{}",
        t.wrong.len(),
        t.wrong.join("\n")
    );
    assert!(t.certified_writes > 0);
    assert!(t.successes > 0, "no revert succeeded");
    assert!(t.ambiguous > 0, "no rotation ambiguity was exercised");
    assert!(
        t.far_ambiguous > 0,
        "no ambiguity two or more units from its run was exercised"
    );
    assert!(
        t.refusals > 0 && t.refused_commits > 0,
        "no revert was refused"
    );
    eprintln!(
        "fuzz: {} certified writes, {} exact reverts, {} refusals ({} ambiguous, {} of them two or more units from their run, {} committed for real), {} worlds dropped",
        t.certified_writes, t.successes, t.refusals, t.ambiguous, t.far_ambiguous, t.refused_commits, t.worlds_dropped
    );
}
