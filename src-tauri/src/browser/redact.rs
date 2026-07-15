//! What a log may say about a URL.
//!
//! A committed URL's path and query routinely carry session tokens, document ids and other
//! things that have no business being written to a log file that outlives them — and the
//! authorization logs (`REFUSED click on …`) were writing them verbatim.
//!
//! The origin is the whole of what an authorization decision is made against, so it is also
//! the whole of what a log about that decision needs. Kept out of `origin_guard.rs` because
//! that module is policy and this is presentation — and because the guard is at its size
//! limit, which is a reasonable prompt to ask which of the two a function actually is.
//!
//! @coordinates-with browser/origin_guard.rs — canonicalize_origin
//! @coordinates-with browser/commands_auth.rs — the authorization logs

use crate::browser::origin_guard::canonicalize_origin;

/// A URL reduced to its origin (`scheme://host[:port]`), for logging.
///
/// A URL that cannot be canonicalized is reported as `<opaque>` rather than echoed — an
/// unparseable string is exactly the kind we should be least willing to paste into a log.
pub fn redact(url: &str) -> String {
    match canonicalize_origin(url) {
        Some(origin) => {
            let default_port = if origin.scheme == "https" { 443 } else { 80 };
            if origin.port == default_port {
                format!("{}://{}", origin.scheme, origin.host)
            } else {
                format!("{}://{}:{}", origin.scheme, origin.host, origin.port)
            }
        }
        None => "<opaque>".to_string(),
    }
}

#[cfg(test)]
#[path = "redact.test.rs"]
mod tests;
