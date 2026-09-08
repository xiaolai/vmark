//! The Linux session-bus gate for the single-instance guard (WI-FL6.1).
//!
//! Purpose: decide, from `DBUS_SESSION_BUS_ADDRESS` alone, whether the
//! single-instance plugin may be registered — WITHOUT touching the network,
//! the filesystem or a name service, because this runs on the startup path
//! before anything else exists.
//!
//! ## What actually aborts VMark, read from the vendored plugin
//!
//! `tauri-plugin-single-instance` 2.4.3, `src/platform_impl/linux.rs`:
//!
//! ```text
//! match zbus::blocking::connection::Builder::session()
//!         .unwrap()                              // ← the abort
//!         .name(..).unwrap().serve_at(..).unwrap()
//!         .build() {
//!     Ok(connection) => { .. }
//!     Err(zbus::Error::NameTaken) => { .. }
//!     _ => {}                                    // ← everything else: discarded
//! }
//! ```
//!
//! `Builder::session()` is `Address::session()`, which is `Address::from_str`
//! over the raw environment value — a PARSE, with no I/O at all (zbus 5.16,
//! `src/address/mod.rs`). Its `Err` is unwrapped, so a value zbus cannot parse
//! panics the process before the log plugin exists to say why. A value it CAN
//! parse but cannot CONNECT to reaches `.build()`, and that error lands in the
//! `_ => {}` arm: the app runs on, simply unguarded.
//!
//! So the only question this gate has to answer is **"would zbus parse it?"**,
//! and that question needs no socket. Round 2 answered a different question —
//! it connected and spoke SASL — which bought no protection the `_ => {}` arm
//! was not already giving, and paid for it with unbounded I/O on the startup
//! path: a DNS lookup with no timeout, a connect per resolved address, and a
//! greeting read that a peer dribbling one byte at a time could hold for
//! minutes. Startup must never hang; this file now cannot make it.
//!
//! Key decisions:
//!   - **The RAW value is ONE address.** zbus does not split on `;` and does
//!     not trim, so neither does this (#245). ` unix:path=/run/user/1000/bus`
//!     reads as the transport `" unix"` — "unsupported transport", an abort —
//!     and `a;b` reads as one address whose option value contains a `;`.
//!   - **Stricter than zbus is safe; laxer is the abort.** Refusing costs only
//!     the guard, and `app_setup` logs that. So a duplicate option key, a
//!     `guid` in any spelling other than the 32-hex form a bus emits, and every
//!     transport below are refused even where zbus would parse them.
//!   - **Only `unix:path=` and `unix:abstract=` are accepted.** They are the
//!     forms a desktop session actually carries, and the only ones whose
//!     connect is a local socket lookup. `tcp:`/`nonce-tcp:` are refused
//!     because zbus resolves the host and connects INSIDE the plugin's
//!     blocking `setup`, where a name service that never answers, or a
//!     firewalled port, holds startup for as long as the resolver and the TCP
//!     stack care to; `unixexec:` and `ibus:` reach a bus by RUNNING a program;
//!     `dir=`/`tmpdir=` describe a listener, not a bus a client can reach.
//!   - **Nothing here does I/O**, so a stale address (a socket file whose
//!     daemon is gone) is accepted and the plugin's own connect fails into the
//!     `_ => {}` arm. That is the same outcome as refusing, minus the warning.
//!   - The rules encoded are zbus's LINUX rules, on every platform: only the
//!     Linux gate consults the decision, and compiling it everywhere is what
//!     lets `session_bus.test.rs` pin it on the dev platform (macOS).
//!
//! @coordinates-with single_instance.rs — `session_bus_present`, the caller
//! @coordinates-with lib.rs — registers the plugin only when the gate says so
//! @module session_bus

use std::collections::HashMap;

/// A D-Bus GUID as a bus writes it: 32 hex digits.
const GUID_LEN: usize = 32;

/// Whether the guard may be registered, given the session-bus address the
/// environment carries (WI-FL6.1).
///
/// True only for a value zbus is CERTAIN to parse into a local unix-socket
/// address — see the module docs for why that is the whole question, and why
/// this function performs no I/O.
///
/// Only the Linux gate calls it — Windows registers unconditionally — but it
/// is compiled everywhere so its tests run on the dev platform, hence the
/// off-Linux dead-code allowance.
///
/// The allowance is on THIS ITEM and nothing else (#471). It used to be
/// `#![cfg_attr(…, allow(dead_code))]` over the whole module, which covered
/// every future item too — so an orphan left behind by a later edit would have
/// been silenced along with this one. rustc treats an `allow(dead_code)` item
/// as a live root, so the private helpers this function reaches stay covered
/// while anything it does NOT reach is reported.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn should_register_single_instance(bus: Option<std::ffi::OsString>) -> bool {
    let Some(value) = bus else {
        // Unset is not an abort — zbus falls back to
        // `unix:path=$XDG_RUNTIME_DIR/bus`, which parses. It is also not
        // evidence of a bus, and with no I/O this cannot tell a live fallback
        // socket from none, so the decision stays one-way: register only on
        // positive evidence, and let `warn_if_unguarded` say the guard is off.
        return false;
    };
    let Some(text) = value.to_str() else {
        // zbus's `env::var` rejects non-UTF-8 too, and falls back — so this is
        // stricter, not laxer.
        return false;
    };
    usable_bus_address(text)
}

/// The raw value, judged as ONE D-Bus address the way zbus 5's
/// `Address::from_str` + `Transport::from_options` judge it, then narrowed to
/// the local-socket forms this gate is willing to hand the plugin.
fn usable_bus_address(address: &str) -> bool {
    // zbus reads the transport with `take_until(1.., b':')`: everything before
    // the FIRST colon, and it must be non-empty. No trimming happens anywhere,
    // which is why a padded value is a different transport.
    let Some((transport, params)) = address.split_once(':') else {
        return false;
    };
    if transport != "unix" {
        return false;
    }
    let Some(params) = parse_params(params) else {
        return false;
    };
    // `guid` is parsed by zbus for EVERY transport, and an unparseable one
    // fails the whole address — so a socket that exists behind a bad guid is
    // still an abort.
    if let Some(guid) = params.get("guid") {
        if !is_bus_guid(guid) {
            return false;
        }
    }
    usable_unix(&params)
}

/// `key=value,key=value` as a map; `None` when zbus's parser would refuse it,
/// or when this gate refuses it for being stricter.
///
/// zbus parses keys with `alphanumeric1` and values with
/// `take_while(1.., |b| b != b',')`, joined by `=` and separated by `,`, and
/// requires the WHOLE input to be consumed. So an empty segment, a segment
/// with no `=`, a non-alphanumeric key and an empty value are each a parse
/// error there. A duplicate key is not — zbus collects into a `HashMap` and
/// the last one wins — but it is a malformed environment, and refusing it
/// costs only the guard.
fn parse_params(params: &str) -> Option<HashMap<&str, &str>> {
    let mut map = HashMap::new();
    if params.is_empty() {
        return Some(map);
    }
    for segment in params.split(',') {
        let (key, value) = segment.split_once('=')?;
        if value.is_empty() || key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
            return None;
        }
        if map.insert(key, value).is_some() {
            return None;
        }
    }
    Some(map)
}

/// The 32-hex-digit form a bus emits. zbus hands the value to
/// `uuid::Uuid::try_parse`, which also accepts hyphenated, braced and `urn:`
/// spellings; none of them appear in `DBUS_SESSION_BUS_ADDRESS`, and refusing
/// them costs only the guard.
fn is_bus_guid(guid: &str) -> bool {
    guid.len() == GUID_LEN && guid.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `unix:` takes EXACTLY one of `path`, `abstract`, `dir`, `tmpdir` — zbus
/// errors on any other count. The last two describe where a SERVER should
/// create its socket, not a bus a client can reach, so only the first two are
/// accepted here.
fn usable_unix(params: &HashMap<&str, &str>) -> bool {
    let keyed = ["path", "abstract", "dir", "tmpdir"]
        .iter()
        .filter(|key| params.contains_key(*key))
        .count();
    keyed == 1 && (params.contains_key("path") || params.contains_key("abstract"))
}

#[cfg(test)]
#[path = "session_bus.test.rs"]
mod tests;
