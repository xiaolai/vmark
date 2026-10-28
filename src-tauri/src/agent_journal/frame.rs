//! Length + checksum framing and the torn-tail scan.
//!
//! Frame = `MAGIC` (4) ‖ payload length u32 LE (4) ‖ checksum (8) ‖ payload.
//! Checksum = first 8 bytes of SHA-256(length ‖ payload).
//!
//! A crash during an append can only leave a PREFIX of the last frame, or
//! (on some filesystems) a zero-filled extension. So the scan stops at the
//! first frame that is not whole and classifies what follows:
//! - torn — fewer bytes than a header, a length running past EOF, an
//!   all-zero tail, or a bad checksum on a frame ending exactly at EOF.
//!   Recovery truncates it: the record survives whole or not at all.
//! - corrupt — anything else (bad magic or bad checksum with data after it).
//!   Truncating would silently drop valid later records, so it is refused.
//!
//! `scan_stream` is the one classifier, in bounded memory (the blob pack,
//! whose index is built without holding the pack in memory); `scan` runs it
//! over a whole image and collects the frames (the journal replays every
//! record anyway).

use std::io::{self, Read};

use sha2_v011::{Digest, Sha256};

pub const MAGIC: [u8; 4] = *b"ALJ1";
pub const HEADER_LEN: usize = 16;

/// One whole frame found by `scan`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Byte offset of the payload in the scanned buffer.
    pub payload_offset: u64,
    pub payload: Vec<u8>,
}

/// What follows the last whole frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tail {
    Clean,
    Torn { at: u64, bytes: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scan {
    pub frames: Vec<Frame>,
    pub valid_len: u64,
    pub tail: Tail,
}

fn checksum(len: u32, payload: &[u8]) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(len.to_le_bytes());
    h.update(payload);
    let d = h.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&d[..8]);
    out
}

/// Frame a payload. Payloads over `u32::MAX` bytes are a caller bug.
pub fn encode(payload: &[u8]) -> Vec<u8> {
    let len = u32::try_from(payload.len()).expect("payload fits a u32 length");
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&checksum(len, payload));
    out.extend_from_slice(payload);
    out
}

/// Scan a whole file image. `Err` means corruption that is not a torn tail.
/// The classification is `scan_stream`'s own, collected into frames.
pub fn scan(bytes: &[u8]) -> Result<Scan, String> {
    let mut sink = Collect::default();
    let mut reader = bytes;
    let s = scan_stream(&mut reader, bytes.len() as u64, &mut sink)?;
    Ok(Scan {
        frames: sink.frames,
        valid_len: s.valid_len,
        tail: s.tail,
    })
}

/// Gathers each whole frame's payload for `scan`.
#[derive(Default)]
struct Collect {
    cur: Vec<u8>,
    frames: Vec<Frame>,
}

impl FrameSink for Collect {
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.cur.extend_from_slice(bytes);
        Ok(())
    }
    fn frame(&mut self, payload_offset: u64, _len: u64) -> Result<(), String> {
        self.frames.push(Frame {
            payload_offset,
            payload: std::mem::take(&mut self.cur),
        });
        Ok(())
    }
    fn discard(&mut self) {
        self.cur.clear();
    }
}

/// Receives a streamed scan's payload bytes. Chunks arrive in order; a
/// frame's chunks are followed by `frame` when its checksum holds, or by
/// `discard` when it is torn or damaged.
pub trait FrameSink {
    /// Part of the current frame's payload. `Err` stops the scan before
    /// anything is truncated (the file is then refused, not repaired).
    fn chunk(&mut self, bytes: &[u8]) -> Result<(), String>;
    /// One whole, checksummed frame ended. `Err` makes the file corrupt.
    fn frame(&mut self, payload_offset: u64, len: u64) -> Result<(), String>;
    fn discard(&mut self);
}

/// `scan` without the frames: they went to the sink.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamScan {
    pub valid_len: u64,
    pub tail: Tail,
}

const CHUNK: usize = 64 * 1024;

fn rest_is_zero(r: &mut dyn Read, mut left: u64, buf: &mut [u8]) -> io::Result<bool> {
    while left > 0 {
        let n = left.min(buf.len() as u64) as usize;
        r.read_exact(&mut buf[..n])?;
        if buf[..n].iter().any(|b| *b != 0) {
            return Ok(false);
        }
        left -= n as u64;
    }
    Ok(true)
}

/// `scan` over a reader of `file_len` bytes, in bounded memory: each
/// payload is hashed and handed to `sink` in chunks, never held whole.
pub fn scan_stream(
    r: &mut dyn Read,
    file_len: u64,
    sink: &mut dyn FrameSink,
) -> Result<StreamScan, String> {
    let mut buf = vec![0u8; CHUNK];
    let mut pos = 0u64;
    let io = |e: io::Error| e.to_string();
    while pos < file_len {
        let rest = file_len - pos;
        let torn = Ok(StreamScan {
            valid_len: pos,
            tail: Tail::Torn {
                at: pos,
                bytes: rest,
            },
        });
        if rest < HEADER_LEN as u64 {
            return torn;
        }
        let mut header = [0u8; HEADER_LEN];
        r.read_exact(&mut header).map_err(io)?;
        if header[..4] != MAGIC {
            if header.iter().all(|b| *b == 0)
                && rest_is_zero(r, rest - HEADER_LEN as u64, &mut buf).map_err(io)?
            {
                return torn;
            }
            return Err(format!(
                "bad frame magic at byte {pos} with {rest} bytes after it"
            ));
        }
        let len = u32::from_le_bytes(header[4..8].try_into().expect("4 bytes"));
        let end = HEADER_LEN as u64 + u64::from(len);
        if rest < end {
            return torn;
        }
        let mut h = Sha256::new();
        h.update(len.to_le_bytes());
        let mut left = u64::from(len);
        while left > 0 {
            let n = left.min(CHUNK as u64) as usize;
            r.read_exact(&mut buf[..n]).map_err(io)?;
            h.update(&buf[..n]);
            sink.chunk(&buf[..n])?;
            left -= n as u64;
        }
        if header[8..16] != h.finalize()[..8] {
            sink.discard();
            if rest == end {
                return torn;
            }
            return Err(format!(
                "checksum mismatch in the frame at byte {pos}, which is not the last frame"
            ));
        }
        sink.frame(pos + HEADER_LEN as u64, u64::from(len))?;
        pos += end;
    }
    Ok(StreamScan {
        valid_len: pos,
        tail: Tail::Clean,
    })
}
