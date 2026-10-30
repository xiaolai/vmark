//! The Linux WebKitGTK workaround's one decision: turn the DMABUF renderer
//! off unless the user already chose a value, so `=0` opts back in.

use super::dmabuf_renderer_override;
use std::ffi::OsStr;

#[test]
fn an_unset_dmabuf_variable_is_set_to_disable_the_renderer() {
    assert_eq!(dmabuf_renderer_override(None), Some("1"));
}

#[test]
fn a_value_the_user_chose_is_left_alone() {
    for chosen in ["0", "1", ""] {
        assert_eq!(
            dmabuf_renderer_override(Some(OsStr::new(chosen))),
            None,
            "{chosen:?}"
        );
    }
}
