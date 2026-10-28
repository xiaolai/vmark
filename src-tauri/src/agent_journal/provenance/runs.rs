//! The run-length form of a position function, as persisted: per-position
//! deltas `V(p) − V(p−1)` and their inverse, rebuilding pieces under a
//! hard cap.

use super::pieces::{value_of, Piece};

/// Run-length per-position deltas `V(p) − V(p−1)`, `p = 1..=len_a`, as `[(count, delta)]`.
pub fn delta_runs(pieces: &[Piece]) -> Vec<(i64, i64)> {
    let mut runs: Vec<(i64, i64)> = Vec::new();
    let mut push = |n: i64, dv: i64| {
        if n <= 0 {
            return;
        }
        match runs.last_mut() {
            Some(last) if last.1 == dv => last.0 += n,
            _ => runs.push((n, dv)),
        }
    };
    for (i, piece) in pieces.iter().enumerate() {
        if i > 0 {
            let prev = &pieces[i - 1];
            push(1, value_of(piece, piece.a) - value_of(prev, prev.b));
        }
        // Position 0 has no delta; a later piece's first position is the jump above.
        push(piece.b - (piece.a + 1) + 1, piece.s);
    }
    runs
}

/// Rebuilds the fewest pieces from `V(0)` and per-position delta runs
/// (adjacent runs may repeat a delta). A piece keeps a stretch of equal
/// deltas, each 0 or 1; where two runs of different keepable deltas meet,
/// one of the two deltas starts a new piece. Choosing the later one at the
/// first such meeting not already broken is optimal (the earlier is a leaf
/// of a path), so no accumulator holds this map in fewer pieces: a decoded
/// accumulator is never larger than the one that wrote it. Fails on a
/// shape pieces cannot hold, or on more than `max_pieces` pieces (a hostile
/// body could otherwise expand one run into 2^53 points).
pub fn pieces_from_runs(
    v0: i64,
    runs: &[(i64, i64)],
    len_a: i64,
    max_pieces: usize,
) -> Result<Vec<Piece>, String> {
    let runs = merged_runs(runs, len_a)?;
    // Whether each run's first delta continues the piece before it.
    let mut joins: Vec<bool> = runs.iter().map(|r| r.1 <= 1).collect();
    for i in 1..runs.len() {
        // The previous run's last delta is kept unless it is its first and was dropped.
        let prev_last_kept = runs[i - 1].1 <= 1 && (runs[i - 1].0 > 1 || joins[i - 1]);
        if joins[i] && prev_last_kept {
            joins[i] = false;
        }
    }
    let mut out = vec![Piece {
        a: 0,
        b: 0,
        s: 1,
        o: v0,
    }];
    let (mut p, mut v) = (1_i64, v0);
    for (&(n, dv), &join) in runs.iter().zip(&joins) {
        if dv <= 1 {
            v = safe_add(v, dv * n)?;
            if !join {
                start(&mut out, p, v - dv * (n - 1));
            }
            extend(&mut out, p + n - 1, dv);
        } else {
            if out.len() as u64 + n as u64 > max_pieces as u64 {
                return Err("provenance runs exceed the cap".into());
            }
            // Consecutive jumps of the same size (touching sections) are points, one per position.
            for q in p..p + n {
                v = safe_add(v, dv)?;
                start(&mut out, q, v);
            }
        }
        if out.len() > max_pieces {
            return Err("provenance runs exceed the cap".into());
        }
        p += n;
    }
    Ok(out)
}

/// Validated runs covering positions `1..=len_a`, adjacent equal deltas merged.
fn merged_runs(runs: &[(i64, i64)], len_a: i64) -> Result<Vec<(i64, i64)>, String> {
    let mut out: Vec<(i64, i64)> = Vec::with_capacity(runs.len());
    let mut covered = 0_i64;
    for &(n, dv) in runs {
        if n < 1 || dv < 0 || covered + n > len_a {
            return Err(format!("malformed provenance run [{n}, {dv}]"));
        }
        covered += n;
        match out.last_mut() {
            Some(last) if last.1 == dv => last.0 += n,
            _ => out.push((n, dv)),
        }
    }
    if covered != len_a {
        return Err(format!(
            "malformed provenance runs: cover {covered} positions, lenA is {len_a}"
        ));
    }
    Ok(out)
}

fn safe_add(v: i64, d: i64) -> Result<i64, String> {
    v.checked_add(d)
        .filter(|v| *v <= super::MAX_SAFE)
        .ok_or_else(|| "provenance map exceeds 2^53-1".to_string())
}

/// A new one-position piece at `p` with value `v` (a point is a slope piece).
fn start(out: &mut Vec<Piece>, p: i64, v: i64) {
    out.push(Piece {
        a: p,
        b: p,
        s: 1,
        o: v - p,
    });
}

/// Extends the last piece through position `to` with per-position delta
/// `dv` (0 or 1); a one-position piece takes the slope.
fn extend(out: &mut [Piece], to: i64, dv: i64) {
    let last = out.last_mut().expect("a piece at gap 0");
    if to == last.b {
        return; // still one position: it stays a point
    }
    if last.a == last.b && dv == 0 {
        *last = Piece {
            a: last.a,
            b: to,
            s: 0,
            o: last.a + last.o,
        };
    } else {
        last.b = to;
    }
}
