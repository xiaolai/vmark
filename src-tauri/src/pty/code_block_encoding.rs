//! CMD reads batch files in the Windows OEM code page. Matching that page also
//! avoids UTF-8 batch line truncation on affected Windows builds. ConPTY still
//! delivers console output as UTF-8. Unrepresentable source is rejected.
//! @module pty/code_block_encoding
use crate::command_error::CommandError;

pub(super) fn cmd_code_page() -> u32 {
    #[cfg(windows)]
    // SAFETY: GetOEMCP has no arguments or memory preconditions.
    unsafe {
        windows::GetOEMCP()
    }
    #[cfg(not(windows))]
    {
        65001
    }
}

pub(super) fn encode_cmd(source: &str) -> Result<Vec<u8>, CommandError> {
    #[cfg(windows)]
    {
        let page = cmd_code_page();
        if page != 65001 {
            let wide: Vec<u16> = source.encode_utf16().collect();
            let mut substituted = 0;
            // SAFETY: the UTF-16 slice is live for its stated length; a null
            // output with size zero requests the required buffer size.
            let size = unsafe {
                windows::WideCharToMultiByte(
                    page,
                    0x400,
                    wide.as_ptr(),
                    wide.len() as i32,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null(),
                    &mut substituted,
                )
            };
            let mut bytes = vec![0; size.max(0) as usize];
            // SAFETY: both buffers are live for their stated lengths. The
            // default-character flag points to a valid i32 for this call.
            let written = unsafe {
                windows::WideCharToMultiByte(
                    page,
                    0x400,
                    wide.as_ptr(),
                    wide.len() as i32,
                    bytes.as_mut_ptr(),
                    size,
                    std::ptr::null(),
                    &mut substituted,
                )
            };
            if written <= 0 || substituted != 0 {
                return Err(CommandError::invalid_input("CMD source cannot be represented in the system code page; use PowerShell or Python"));
            }
            bytes.truncate(written as usize);
            return Ok(bytes);
        }
    }
    Ok(source.as_bytes().to_vec())
}

#[cfg(windows)]
mod windows {
    #[link(name = "kernel32")]
    extern "system" {
        pub(super) fn GetOEMCP() -> u32;
        pub(super) fn WideCharToMultiByte(
            page: u32,
            flags: u32,
            source: *const u16,
            source_len: i32,
            target: *mut u8,
            target_len: i32,
            default_char: *const u8,
            used_default: *mut i32,
        ) -> i32;
    }
}
