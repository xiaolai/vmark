//! One monotone position function of the accumulator, kept as pieces.
//! A piece `{a, b, s, o}` covers original
//! gaps `p ∈ [a, b]` with `V(p) = p + o` (slope, `s = 1`) or `V(p) = o`
//! (constant, `s = 0`). Composing a transaction maps every value with
//! CodeMirror's own section rule (`map_pos`, `ChangeDesc.mapPos` in
//! `MapMode.Simple`), so the result is the SEQUENTIAL mapping. Pieces are
//! coalesced as they are emitted, so a site typed and deleted many times
//! stays a constant number of pieces.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Piece {
    pub a: i64,
    pub b: i64,
    pub s: i64,
    pub o: i64,
}

/// One CodeMirror section `{fromA, toA, fromB, toB}` (`iterChanges(f, true)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Section {
    pub from_a: i64,
    pub to_a: i64,
    pub from_b: i64,
    pub to_b: i64,
}

/// Fails unless the transaction is a sorted, consistent, in-bounds section
/// list whose resulting document is at most 2^53−1 long; drops sections
/// that change nothing.
pub fn validate_changes(changes: &[Section], len_b: i64) -> Result<Vec<Section>, String> {
    let (mut prev_to_a, mut offset) = (0, 0);
    let mut out = Vec::with_capacity(changes.len());
    for c in changes {
        let bad = c.from_a < prev_to_a
            || c.to_a < c.from_a
            || c.to_b < c.from_b
            || c.to_a > len_b
            || c.from_b != c.from_a + offset;
        if bad || c.to_b > super::MAX_SAFE {
            return Err(format!(
                "malformed transaction section {c:?} (length {len_b})"
            ));
        }
        offset = c.to_b - c.to_a;
        prev_to_a = c.to_a;
        if c.from_a == c.to_a && c.from_b == c.to_b {
            continue;
        }
        out.push(*c);
    }
    // Everything after the last section shifts by its offset.
    if len_b + offset > super::MAX_SAFE {
        return Err(format!(
            "transaction makes the document longer than 2^53-1 (length {len_b})"
        ));
    }
    Ok(out)
}

/// First index whose `to_a >= pos` (`changes.len()` when none).
fn first_ending_at_or_after(changes: &[Section], pos: i64) -> usize {
    changes.partition_point(|c| c.to_a < pos)
}

fn trailing_offset(changes: &[Section]) -> i64 {
    changes.last().map_or(0, |l| l.to_b - l.to_a)
}

/// CodeMirror's `mapPos` over a section list (sections may touch; never merged).
pub fn map_pos(changes: &[Section], pos: i64, assoc: i64) -> i64 {
    let mut i = first_ending_at_or_after(changes, pos);
    // A section ending exactly at pos is passed unless it is an insertion mapped with assoc < 0.
    while i < changes.len() && changes[i].to_a == pos && !(changes[i].from_a == pos && assoc < 0) {
        i += 1;
    }
    let Some(c) = changes.get(i) else {
        return pos + trailing_offset(changes);
    };
    if pos < c.from_a {
        return pos + (c.from_b - c.from_a);
    }
    if pos == c.from_a || assoc < 0 {
        c.from_b
    } else {
        c.to_b
    }
}

fn offset_before(changes: &[Section], j: usize) -> i64 {
    match changes.get(j) {
        Some(c) => c.from_b - c.from_a,
        None => trailing_offset(changes),
    }
}

/// Appends a piece, coalescing with the previous one when the function continues unchanged.
pub fn push_piece(out: &mut Vec<Piece>, a: i64, b: i64, s: i64, o: i64) {
    let last = out.last().copied();
    if a == b {
        // A single point: a slope piece unless it continues the previous piece.
        let v = if s == 1 { a + o } else { o };
        if let Some(l) = last {
            if (l.s == 0 && l.o == v) || (l.s == 1 && a + l.o == v) {
                out.last_mut().expect("last").b = b;
                return;
            }
        }
        out.push(Piece {
            a,
            b,
            s: 1,
            o: v - a,
        });
        return;
    }
    if let Some(l) = last {
        if l.s == s && l.o == o {
            out.last_mut().expect("last").b = b;
            return;
        }
        if s == 0 && l.a == l.b && l.a + l.o == o {
            *out.last_mut().expect("last") = Piece { a: l.a, b, s: 0, o };
            return;
        }
    }
    out.push(Piece { a, b, s, o });
}

pub fn value_of(piece: &Piece, p: i64) -> i64 {
    if piece.s == 1 {
        p + piece.o
    } else {
        piece.o
    }
}

/// Index of the piece covering `p`.
pub fn piece_at(pieces: &[Piece], p: i64) -> usize {
    pieces.partition_point(|x| x.a <= p).saturating_sub(1)
}

pub fn evaluate(pieces: &[Piece], p: i64) -> i64 {
    value_of(&pieces[piece_at(pieces, p)], p)
}

/// Smallest `p` with `V(p) > x` (strict) or `V(p) >= x`; `len_a + 1` when none.
pub fn lower_p(pieces: &[Piece], len_a: i64, x: i64, strict: bool) -> i64 {
    let ok = |v: i64| if strict { v > x } else { v >= x };
    let lo = pieces.partition_point(|piece| !ok(value_of(piece, piece.b)));
    let Some(piece) = pieces.get(lo) else {
        return len_a + 1;
    };
    if piece.s == 0 {
        return piece.a;
    }
    piece.a.max((if strict { x + 1 } else { x }) - piece.o)
}

/// Composes `V` with one validated transaction: `V'(p) = map_pos(V(p), assoc)`.
///
/// `limit` stops composing once the result holds more than `limit` pieces and
/// returns `None`: pieces are only appended or widened, so the finished map
/// would hold more too, and a capped caller need not build it.
pub fn compose_pieces(
    pieces: &[Piece],
    changes: &[Section],
    assoc: i64,
    limit: usize,
) -> Option<Vec<Piece>> {
    let (Some(first), Some(last)) = (changes.first(), changes.last()) else {
        return (pieces.len() <= limit).then(|| pieces.to_vec());
    };
    let delta = last.to_b - last.to_a;
    let mut out =
        Vec::with_capacity((pieces.len() + 2 * changes.len()).min(limit.saturating_add(1)));
    for piece in pieces {
        let (lo, hi) = (piece.a + piece.o, piece.b + piece.o);
        if piece.s == 0 {
            let v = map_pos(changes, piece.o, assoc);
            push_piece(&mut out, piece.a, piece.b, 0, v);
        } else if hi < first.from_a {
            push_piece(&mut out, piece.a, piece.b, 1, piece.o);
        } else if lo > last.to_a {
            push_piece(&mut out, piece.a, piece.b, 1, piece.o + delta);
        } else {
            compose_slope(&mut out, piece, changes, assoc, limit);
        }
        if out.len() > limit {
            return None;
        }
    }
    Some(out)
}

/// A slope piece whose values `[lo, hi]` meet the sections: walked section
/// by section, then the stretch after the last one it reaches; stops early
/// once `out` passes `limit`.
fn compose_slope(
    out: &mut Vec<Piece>,
    piece: &Piece,
    changes: &[Section],
    assoc: i64,
    limit: usize,
) {
    let (lo, hi, d) = (piece.a + piece.o, piece.b + piece.o, piece.o);
    let mut cur = lo;
    let mut j = first_ending_at_or_after(changes, lo);
    while j < changes.len() && cur <= hi && out.len() <= limit {
        cur = through_section(out, changes, j, cur, hi, d, assoc);
        j += 1;
    }
    if cur <= hi && out.len() <= limit {
        push_piece(out, cur - d, hi - d, 1, d + offset_before(changes, j));
    }
}

/// Emits values `cur..` up to and including section `j`: the unchanged
/// stretch before it as a slope, its edges as points, its interior as a
/// constant. Returns the next value to emit (past `hi` when done).
fn through_section(
    out: &mut Vec<Piece>,
    changes: &[Section],
    j: usize,
    mut cur: i64,
    hi: i64,
    d: i64,
    assoc: i64,
) -> i64 {
    let c = changes[j];
    if cur < c.from_a {
        let e = (c.from_a - 1).min(hi);
        push_piece(out, cur - d, e - d, 1, d + c.from_b - c.from_a);
        cur = e + 1;
        if cur > hi {
            return cur;
        }
    }
    if cur == c.from_a {
        push_piece(out, cur - d, cur - d, 0, map_pos(changes, cur, assoc));
        cur += 1;
    }
    let ie = (c.to_a - 1).min(hi);
    if cur <= ie {
        let v = if assoc < 0 { c.from_b } else { c.to_b };
        push_piece(out, cur - d, ie - d, 0, v);
        cur = ie + 1;
    }
    if cur == c.to_a && cur <= hi {
        push_piece(out, cur - d, cur - d, 0, map_pos(changes, cur, assoc));
        cur += 1;
    }
    cur
}
