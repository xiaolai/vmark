// WI-AL2.2a — the staging clone's cost: cloning the projection of a default-cap journal (50 documents × 500 revisions, about a tenth of them agent writes with hunks) stays within 10 ms of this thread's CPU time, the budget R44 rule 8 sets before a document-scoped copy-on-write is needed
//! Ignored by default (it builds 25,000 revisions); run it with
//! `cargo test --release --lib admission_clone_cost -- --ignored --nocapture`.

#[cfg(unix)]
use crate::agent_journal::test_support::{agent_change, diff_edit, human_save, open_fast, tmp};

/// CPU time of this thread, in nanoseconds (not wall time, so other test
/// threads never count).
#[cfg(unix)]
fn thread_cpu_ns() -> u128 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid out-pointer for the duration of the call.
    let rc = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    assert_eq!(rc, 0, "clock_gettime");
    t.tv_sec as u128 * 1_000_000_000 + t.tv_nsec as u128
}

#[cfg(unix)]
#[test]
#[ignore = "measurement: builds 25,000 revisions"]
fn cloning_a_default_cap_projection_stays_within_ten_ms_of_cpu() {
    use crate::agent_journal::ids::DocId;
    const DOCS: usize = 50;
    const REVISIONS: usize = 500;
    let dir = tmp();
    let (w, _) = open_fast(dir.path());
    for d in 0..DOCS {
        let doc = DocId::new();
        let mut text = String::new();
        for r in 0..REVISIONS {
            if r % 10 == 9 {
                let post = format!("{text}agent {r}\n");
                agent_change(&w, doc, &text, &post, diff_edit(&text, &post));
                text = post;
            } else {
                text = format!("doc {d} line {r}\n{text}");
                human_save(&w, doc, &text);
            }
            if text.len() > 2_000 {
                text = format!("doc {d} reset {r}\n");
                human_save(&w, doc, &text);
            }
        }
    }
    let g = w.lock();
    assert!(
        g.proj.revisions.len() >= DOCS * REVISIONS,
        "{}",
        g.proj.revisions.len()
    );
    let mut samples: Vec<u128> = (0..21)
        .map(|_| {
            let t = thread_cpu_ns();
            let copy = std::hint::black_box(g.proj.clone());
            let spent = thread_cpu_ns() - t;
            drop(copy);
            spent
        })
        .collect();
    samples.sort_unstable();
    let ms = |ns: u128| ns as f64 / 1e6;
    println!(
        "projection clone, {} revisions, {} hunks: median {:.3} ms, max {:.3} ms CPU",
        g.proj.revisions.len(),
        g.proj.docs.values().map(|d| d.hunks.len()).sum::<usize>(),
        ms(samples[samples.len() / 2]),
        ms(*samples.last().unwrap()),
    );
    assert!(
        samples[samples.len() / 2] <= 10_000_000,
        "over the 10 ms budget"
    );
}
