//! The persisted body of an accumulator (the `body` of the shared fixture's payloads):
//! encode, and a decode that fails loud on anything malformed: a bounded
//! break that is not an `uncertifiedRange`, a whole break that is one, or a
//! state no accumulator within the cap could hold (the map is rebuilt in
//! its fewest pieces, `runs::pieces_from_runs`).

use serde::{Deserialize, Serialize};

use super::accumulator::{Bounded, Provenance};
use super::intervals::validate_intervals;
use super::pieces::{evaluate, piece_at, value_of, Piece};
use super::runs::{delta_runs, pieces_from_runs};
use super::{required_option, Block, BreakReason, MAX_SAFE};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Body {
    pub len_a: u64,
    pub len_b: u64,
    pub transactions: u64,
    pub map: MapBody,
    pub deleted_chars: Vec<(u64, u64)>,
    pub touched_gaps: Vec<(u64, u64)>,
    pub breaks: Breaks,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapBody {
    #[serde(rename = "L0")]
    pub l0: u64,
    #[serde(rename = "R0")]
    pub r0: u64,
    /// `[count, dL, dR]`.
    pub runs: Vec<(u64, u64, u64)>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Breaks {
    #[serde(deserialize_with = "required_option")]
    pub whole: Option<Block>,
    pub bounded: Vec<BoundedBody>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoundedBody {
    pub normal: (i64, i64),
    pub growing: (i64, i64),
    pub reason: BreakReason,
    pub origin: String,
}

impl Body {
    /// Canonical entries: an upper bound of twice the in-memory entries (§4).
    pub fn canonical_entries(&self) -> usize {
        self.map.runs.len()
            + self.deleted_chars.len()
            + self.touched_gaps.len()
            + self.breaks.bounded.len()
    }
}

fn wire(n: i64) -> u64 {
    u64::try_from(n).expect("encoded values are never negative")
}

fn safe(n: u64, what: &str) -> Result<i64, String> {
    i64::try_from(n)
        .ok()
        .filter(|n| *n <= MAX_SAFE)
        .ok_or_else(|| format!("{what} {n} exceeds 2^53-1"))
}

/// Joins the L and R delta runs into `[count, dL, dR]` runs over the same positions.
fn zip_runs(l: &[(i64, i64)], r: &[(i64, i64)]) -> Vec<(u64, u64, u64)> {
    let mut out: Vec<(i64, i64, i64)> = Vec::new();
    let (mut i, mut j) = (0, 0);
    let (mut li, mut rj) = (l.first().map_or(0, |x| x.0), r.first().map_or(0, |x| x.0));
    while i < l.len() && j < r.len() {
        let n = li.min(rj);
        match out.last_mut() {
            Some(last) if last.1 == l[i].1 && last.2 == r[j].1 => last.0 += n,
            _ => out.push((n, l[i].1, r[j].1)),
        }
        li -= n;
        rj -= n;
        if li == 0 {
            i += 1;
            li = l.get(i).map_or(0, |x| x.0);
        }
        if rj == 0 {
            j += 1;
            rj = r.get(j).map_or(0, |x| x.0);
        }
    }
    out.into_iter()
        .map(|(n, a, b)| (wire(n), wire(a), wire(b)))
        .collect()
}

/// `L ≤ R` at every gap, `L(0) = 0` and `R(len_a) = len_b` (the map
/// accounts for the whole postimage, so no text before the first or after
/// the last original gap goes unrecorded), exact in O(runs): inside a run
/// `R − L` changes by the constant `dR − dL`, so its extremes are at the
/// run's ends. Runs must be canonical (maximal).
fn check_map(l0: i64, r0: i64, runs: &[(i64, i64, i64)], len_b: i64) -> Result<(), String> {
    let (mut l, mut r) = (l0, r0);
    if l0 != 0 {
        return Err("malformed provenance map: L(0) is not 0".into());
    }
    if l > r {
        return Err("malformed provenance map at gap 0".into());
    }
    let mut prev: Option<(i64, i64)> = None;
    for &(n, dl, dr) in runs {
        if prev == Some((dl, dr)) {
            return Err("provenance runs are not canonical".into());
        }
        l += dl;
        r += dr;
        if l > r {
            return Err("malformed provenance map: L > R".into());
        }
        l += dl * (n - 1);
        r += dr * (n - 1);
        if l > r {
            return Err("malformed provenance map: L > R".into());
        }
        prev = Some((dl, dr));
    }
    if r != len_b {
        return Err("malformed provenance map: R(lenA) is not lenB".into());
    }
    Ok(())
}

impl Provenance {
    /// The canonical persisted body.
    pub fn encode(&self) -> Body {
        let interval = |v: &Vec<(i64, i64)>| v.iter().map(|&(a, b)| (wire(a), wire(b))).collect();
        Body {
            len_a: wire(self.len_a),
            len_b: wire(self.len_b),
            transactions: wire(self.transactions),
            map: MapBody {
                l0: wire(evaluate(&self.lp, 0)),
                r0: wire(evaluate(&self.rp, 0)),
                runs: zip_runs(&delta_runs(&self.lp), &delta_runs(&self.rp)),
            },
            deleted_chars: interval(&self.deleted),
            touched_gaps: interval(&self.touched),
            breaks: Breaks {
                whole: self.whole.clone(),
                bounded: self
                    .bounded
                    .iter()
                    .map(|x| BoundedBody {
                        normal: x.normal,
                        growing: x.growing,
                        reason: x.block.reason,
                        origin: x.block.origin.clone(),
                    })
                    .collect(),
            },
        }
    }

    /// Rebuilds an accumulator from its persisted body.
    pub fn decode(body: &Body, cap: u64) -> Result<Self, String> {
        let (len_a, len_b) = (safe(body.len_a, "lenA")?, safe(body.len_b, "lenB")?);
        let mut p = Provenance::new(len_a, cap)?;
        let runs = body
            .map
            .runs
            .iter()
            .map(|&(n, dl, dr)| {
                Ok((
                    safe(n, "run count")?,
                    safe(dl, "run delta")?,
                    safe(dr, "run delta")?,
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let (l0, r0) = (safe(body.map.l0, "L0")?, safe(body.map.r0, "R0")?);
        // The fewest pieces, so one side over the cap is already over it.
        let max_pieces = usize::try_from(cap).unwrap_or(usize::MAX);
        let l_runs: Vec<(i64, i64)> = runs.iter().map(|r| (r.0, r.1)).collect();
        let r_runs: Vec<(i64, i64)> = runs.iter().map(|r| (r.0, r.2)).collect();
        p.lp = pieces_from_runs(l0, &l_runs, len_a, max_pieces)?;
        p.rp = pieces_from_runs(r0, &r_runs, len_a, max_pieces)?;
        check_map(l0, r0, &runs, len_b)?;
        p.len_b = len_b;
        p.transactions = safe(body.transactions, "transactions")?;
        p.deleted = validate_intervals(&body.deleted_chars, 0, len_a - 1, "deletedChars")?;
        p.touched = validate_intervals(&body.touched_gaps, 0, len_a, "touchedGaps")?;
        if let Some(b) = body.breaks.whole.as_ref().filter(|b| !b.reason.is_whole()) {
            return Err(format!("a whole break cannot be {:?}", b.reason));
        }
        p.whole = body.breaks.whole.clone();
        let threshold = |t: (i64, i64)| {
            let ok = (-1..=len_a).contains(&t.0) && (0..=len_a + 1).contains(&t.1);
            if ok {
                Ok(t)
            } else {
                Err(format!("malformed break thresholds {t:?}"))
            }
        };
        p.bounded = body
            .breaks
            .bounded
            .iter()
            .map(|x| {
                if x.reason.is_whole() {
                    return Err(format!("a bounded break cannot be {:?}", x.reason));
                }
                Ok(Bounded {
                    normal: threshold(x.normal)?,
                    growing: threshold(x.growing)?,
                    block: Block::new(x.reason, &x.origin)?,
                })
            })
            .collect::<Result<_, String>>()?;
        // Rebuilt in the fewest pieces, so this is the fewest entries any
        // accumulator with this state holds: more than the cap is a state
        // that should have been a `capOverflow`.
        let entries = p.entries() as u64;
        if entries > cap {
            return Err(format!(
                "the provenance holds {entries} entries, over its cap {cap}"
            ));
        }
        Ok(p)
    }

    /// A certified map must agree with the texts it maps between: every
    /// original character that was never deleted sits, unchanged, at `R(i)`
    /// with `L(i+1) = R(i) + 1`. Lengths are the caller's to check. O(len_a).
    pub fn check_texts(&self, pre: &[u16], post: &[u16]) -> Result<(), String> {
        let (mut di, mut li, mut ri) = (0, 0, 0);
        let value = |pieces: &[Piece], idx: &mut usize, p: i64| {
            while pieces[*idx].b < p {
                *idx += 1;
            }
            value_of(&pieces[*idx], p)
        };
        debug_assert_eq!(piece_at(&self.lp, 0), 0);
        for i in 0..self.len_a {
            while di < self.deleted.len() && self.deleted[di].1 < i {
                di += 1;
            }
            if self.deleted.get(di).is_some_and(|d| d.0 <= i) {
                continue;
            }
            let at = value(&self.rp, &mut ri, i);
            let next = value(&self.lp, &mut li, i + 1);
            let same = usize::try_from(at).ok().and_then(|a| post.get(a)) == pre.get(i as usize);
            if next != at + 1 || !same {
                return Err(format!(
                    "original character {i} survives the map but not the texts"
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "body.test.rs"]
mod tests;
