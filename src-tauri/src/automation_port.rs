//! The debug automation bridge's port, and the probe that pins it (#157).
//!
//! `tauri-plugin-mcp-bridge` 0.12 takes a BASE port and scans up to 100
//! ports above it when the base is busy (`discovery::find_available_port`);
//! there is no fail-closed option. The harness that drives it
//! (`tauri_driver_session`, see `dev-docs/e2e-testing.md`) is pinned to
//! 9323, so a scan that lands on 9324 does not fail — it leaves a bridge
//! nobody can find, while the driver talks to whatever holds 9323.
//!
//! So the port is held to exactly one value from THIS side: `lib.rs` probes
//! it before registering the plugin, and when it is busy the plugin is not
//! registered at all and stderr says why. That is the loud failure the scan
//! was hiding; a bridge on any other port is never started.
//!
//! @coordinates-with lib.rs — the only caller
//! @module automation_port

/// The port `tauri_driver_session` connects to. Debug builds only.
pub(crate) const AUTOMATION_BRIDGE_PORT: u16 = 9323;

/// Can a listener take `port` on loopback right now?
///
/// A bind-and-release, so the plugin's own bind a moment later takes the
/// same port. The window between the two is the one thing this cannot
/// close; it is the dev machine's own loopback, and the alternative was a
/// silent scan.
pub(crate) fn port_is_free(port: u16) -> std::io::Result<()> {
    std::net::TcpListener::bind(("127.0.0.1", port)).map(drop)
}

#[cfg(test)]
mod tests {
    use super::port_is_free;

    /// One attempt at "the probe frees the port again": take an ephemeral
    /// port, release it, probe it, and bind it for real.
    ///
    /// Each step can lose the port to an unrelated binder — this suite shares a
    /// process with tests that bind loopback sockets of their own — and a lost
    /// race is indistinguishable from the defect in a SINGLE attempt (#247).
    /// It is distinguishable across attempts: a probe that kept the port fails
    /// every time, a competing binder does not, so the caller retries with a
    /// fresh port rather than reporting either as the other.
    fn probe_then_bind_once() -> std::io::Result<()> {
        let scratch = std::net::TcpListener::bind("127.0.0.1:0")?;
        let port = scratch.local_addr()?.port();
        drop(scratch);
        port_is_free(port)?;
        // The probe released it: a real listener can take it now.
        std::net::TcpListener::bind(("127.0.0.1", port)).map(drop)
    }

    #[test]
    fn a_free_port_probes_free_and_is_released_for_the_next_binder() {
        let mut last = None;
        for _ in 0..8 {
            match probe_then_bind_once() {
                Ok(()) => return,
                Err(e) => last = Some(e),
            }
        }
        panic!(
            "the probe kept the port on every attempt: {}",
            last.expect("the loop ran at least once")
        );
    }

    #[test]
    fn a_held_port_probes_busy() {
        let holder = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = holder.local_addr().expect("addr").port();
        let err = port_is_free(port).expect_err("held by `holder`");
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse, "{err}");
    }
}
