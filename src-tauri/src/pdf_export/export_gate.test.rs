// #198, #199 — one export at a time, released on every exit path.

use super::ExportGate;
use crate::command_error::CommandError;

#[test]
fn the_gate_starts_open_and_a_second_export_is_refused_while_one_runs() {
    let gate = ExportGate::default();
    assert!(!gate.is_busy());
    let running = gate.try_begin().expect("the first export takes the slot");
    assert!(gate.is_busy());
    assert!(
        gate.try_begin().is_none(),
        "a concurrent export must be refused, not started"
    );
    drop(running);
    assert!(!gate.is_busy(), "dropping the slot reopens the gate");
    assert!(gate.try_begin().is_some(), "the next export may start");
}

#[test]
fn an_early_return_releases_the_slot() {
    // The shape `export_pdf` has: the slot is bound to a local and a `?`
    // leaves the function. The gate must not stay closed behind a failure.
    fn export(gate: &ExportGate) -> Result<(), CommandError> {
        let _slot = gate
            .try_begin()
            .ok_or_else(|| CommandError::conflict("busy"))?;
        Err(CommandError::io("render failed"))?;
        Ok(())
    }
    let gate = ExportGate::default();
    assert!(export(&gate).is_err());
    assert!(!gate.is_busy(), "the failed export released the gate");
}

#[test]
fn a_slot_survives_across_an_await_point_and_is_released_after() {
    let gate = std::sync::Arc::new(ExportGate::default());
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let g = gate.clone();
    rt.block_on(async move {
        let _slot = g.try_begin().expect("open");
        tokio::task::yield_now().await;
        assert!(g.is_busy(), "held across the await");
    });
    assert!(!gate.is_busy());
}

#[test]
fn the_slot_is_decided_exactly_once_under_contention() {
    let gate = std::sync::Arc::new(ExportGate::default());
    let winners: usize = (0..8)
        .map(|_| {
            let gate = gate.clone();
            std::thread::spawn(move || gate.try_begin().map(std::mem::forget).is_some())
        })
        .map(|h| usize::from(h.join().expect("thread")))
        .sum();
    assert_eq!(winners, 1, "exactly one concurrent caller may export");
}
