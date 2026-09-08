// WI-FL6.1 — on Linux the single-instance plugin is registered only when DBUS_SESSION_BUS_ADDRESS names a session bus
//! Tests for `session_bus.rs` (#156, #245): the rules zbus applies to the raw
//! environment value, and the promise that applying them costs no I/O.
//! Loaded via `#[path]`.
//!
//! The gate's question is "would zbus PARSE this?", because that — not the
//! connection — is what the plugin unwraps (see the module docs). So these
//! tests are pure, they run on every platform, and the only timing assertion
//! is the one that would catch a probe being reintroduced.

use super::should_register_single_instance;
use std::ffi::OsString;
use std::time::{Duration, Instant};

/// A guid in the shape a bus actually emits, for the addresses that carry one.
const GUID: &str = "0123456789abcdef0123456789abcdef";

fn gate(value: &str) -> bool {
    should_register_single_instance(Some(OsString::from(value)))
}

// ── the accepted forms ──────────────────────────────────────────────────────

#[test]
fn a_unix_socket_address_enables_the_guard() {
    assert!(gate("unix:path=/run/user/1000/bus"));
    assert!(gate(&format!("unix:path=/run/user/1000/bus,guid={GUID}")));
    assert!(gate("unix:abstract=/tmp/dbus-AbCdEf"));
    assert!(gate(&format!("unix:abstract=/tmp/dbus-AbCdEf,guid={GUID}")));
}

/// Nothing here touches the filesystem, so a socket that does not exist — or
/// one whose daemon has gone — is accepted, and the plugin's own connect fails
/// into the arm that discards it (`_ => {}`). That is the same outcome as
/// refusing, and it is why the gate can be pure.
#[test]
fn a_stale_socket_path_is_still_a_parseable_address() {
    assert!(gate("unix:path=/definitely/not/here/vmark-no-such-bus"));
}

// ── the refused forms ───────────────────────────────────────────────────────

#[test]
fn no_session_bus_address_means_no_guard() {
    assert!(!should_register_single_instance(None));
}

#[test]
fn an_empty_or_blank_session_bus_address_is_as_good_as_none() {
    for value in ["", "   ", "\t\n"] {
        assert!(!gate(value), "{value:?}");
    }
}

#[test]
fn a_malformed_address_does_not_enable_the_guard() {
    for value in [
        // No transport at all, or an empty one.
        "garbage",
        "/run/user/1000/bus",
        ":path=/x",
        // Option syntax zbus's parser refuses: no `=`, an empty key, an empty
        // value, an empty segment, a key that is not alphanumeric.
        "unix:path",
        "unix:=x",
        "unix:path=",
        "unix:path=/x,",
        "unix:path=/x,noequals",
        "unix:path=/x,my_key=1",
        // Padding is not trimmed by zbus, so " unix" is an unsupported
        // transport and a trailing space is part of the option value.
        " unix:path=/x",
        "un ix:path=/x",
    ] {
        assert!(!gate(value), "{value:?}");
    }
}

#[test]
fn a_unix_entry_needs_exactly_one_socket_key() {
    // zbus's `Unix::from_options`: one of path/abstract/dir/tmpdir, no more,
    // no fewer. A bare `unix:` used to pass on syntax alone (#156, #245).
    for value in [
        "unix:",
        &format!("unix:guid={GUID}"),
        "unix:path=/x,abstract=/tmp/dbus-x",
        // A duplicate key is last-wins in zbus; refused here deliberately.
        "unix:path=/x,path=/x",
    ] {
        assert!(!gate(value), "{value:?}");
    }
}

#[test]
fn listener_only_unix_forms_are_not_a_bus_a_client_can_reach() {
    for value in ["unix:dir=/tmp", "unix:tmpdir=/tmp"] {
        assert!(!gate(value), "{value:?}");
    }
}

/// A guid zbus cannot parse fails the WHOLE address, so an otherwise perfect
/// socket behind a bad guid is still the abort this gate exists to prevent.
#[test]
fn a_guid_that_is_not_a_bus_guid_refuses_the_address() {
    for guid in [
        "0123abcd",
        "",
        "0123456789abcdef0123456789abcdeg",
        &GUID[1..],
    ] {
        assert!(!gate(&format!("unix:path=/x,guid={guid}")), "{guid:?}");
    }
}

/// Every transport other than a local unix socket, and why each is refused:
/// `tcp`/`nonce-tcp` connect (and resolve) inside the plugin's blocking setup;
/// `unixexec` and `ibus` reach a bus by running a program; `vsock` needs a
/// zbus feature the plugin does not enable, `launchd`/`autolaunch` are
/// compiled out on Linux, and an unknown word is "unsupported transport".
#[test]
fn only_a_local_unix_socket_transport_enables_the_guard() {
    for value in [
        "tcp:host=127.0.0.1,port=4242",
        "nonce-tcp:host=127.0.0.1,port=4242,noncefile=/tmp/nonce",
        "unixexec:path=/usr/bin/dbus-proxy",
        "ibus:",
        "vsock:cid=3,port=6",
        "launchd:env=DBUS_LAUNCHD_SESSION_BUS_SOCKET",
        "autolaunch:scope=user",
        "systemd:",
    ] {
        assert!(!gate(value), "{value:?}");
    }
}

/// zbus parses the RAW environment value as ONE address: no trimming, no `;`
/// splitting (`Address::session` → `Address::from_str`). A value this gate
/// accepts but zbus refuses is exactly the abort it exists to prevent (#245).
#[test]
fn leading_padding_and_address_lists_are_refused_the_way_zbus_refuses_them() {
    for value in [
        // The transport is everything before the first colon, untrimmed — so
        // this one is the transport `" unix"`: "unsupported transport".
        " unix:path=/run/user/1000/bus",
        // Same rule, so the first entry of a `;` list ends up INSIDE the
        // transport and is unsupported for the same reason.
        "garbage;unix:path=/run/user/1000/bus",
        "garbage;;more garbage",
    ] {
        assert!(
            !gate(value),
            "zbus refuses {value:?}, so this gate must too"
        );
    }
}

/// The other half of "judged the way zbus judges it", and the one that is
/// counter-intuitive: an option value runs to the next COMMA, so trailing
/// padding and everything after a `;` are part of the path. zbus parses these
/// — no abort — and connects to a socket that does not exist, which its caller
/// discards. Refusing them here would be stricter than needed; matching it is
/// what keeps the two parsers comparable at all (#245).
#[test]
fn a_trailing_tail_becomes_part_of_the_path_exactly_as_zbus_reads_it() {
    for value in [
        "unix:path=/run/user/1000/bus ",
        "unix:path=/run/user/1000/bus\n",
        "unix:path=/run/user/1000/bus;unix:path=/run/user/1000/bus",
    ] {
        assert!(
            gate(value),
            "zbus parses {value:?} as one address with an odd path; so does this"
        );
    }
}

// ── the promise that keeps startup alive (#156) ─────────────────────────────

/// The regression this round exists to undo. Round 2's gate connected to the
/// address and waited for a D-Bus greeting, on the startup path, with only
/// per-attempt bounds: a listener that accepts and never answers held it for
/// the full read timeout, and a hostname held it for however long the resolver
/// took. The gate now performs no I/O whatsoever, so the elapsed bound below
/// is what a reintroduced probe would break.
#[test]
fn a_pathological_address_is_judged_without_waiting_for_anything() {
    // A real listener nothing ever accepts from: `connect()` succeeds into the
    // backlog and then the peer says nothing — the case that cost 301ms.
    #[cfg(unix)]
    let _listener = {
        let dir = tempfile::tempdir().expect("tempdir");
        let sock = dir.path().join("silent");
        let listener = std::os::unix::net::UnixListener::bind(&sock).expect("bind");
        let value = format!("unix:path={}", sock.display());
        let started = Instant::now();
        let _ = gate(&value);
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_millis(50),
            "a socket that never answers must not hold startup: took {elapsed:?}"
        );
        (dir, listener)
    };

    // A non-routable address and a name that must never be resolved: both are
    // refused on their transport, before anything could dial or look up.
    for value in [
        "tcp:host=10.255.255.1,port=4242",
        "tcp:host=vmark-no-such-host.invalid,port=4242",
    ] {
        let started = Instant::now();
        assert!(!gate(value));
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "{value:?} took {:?} — the gate must not dial or resolve",
            started.elapsed()
        );
    }
}
