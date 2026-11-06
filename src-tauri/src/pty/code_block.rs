//! One-shot Windows code blocks owned by an existing internal PTY session.
//! Source is a temporary script; its guard follows the PTY's teardown path.
//! @module pty/code_block
use crate::command_error::CommandError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Manager;
#[path = "code_block_encoding.rs"]
mod encoding;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodeShell {
    PowerShell,
    Cmd,
    Python, // A PowerShell host retains the terminal when Python finishes.
}

#[derive(Deserialize)]
pub struct CodeBlockRequest {
    shell: CodeShell,
    source: String,
}

impl CodeShell {
    fn executable(self) -> &'static str {
        match self {
            Self::PowerShell | Self::Python => "powershell.exe",
            Self::Cmd => "cmd.exe",
        }
    }
    fn command(self) -> String {
        match self {
            Self::PowerShell => {
                ". ([scriptblock]::Create([IO.File]::ReadAllText($env:VMARK_CODE_BLOCK_SCRIPT)))\r".into()
            }
            Self::Cmd => format!("chcp {} >nul\r\"%VMARK_CODE_BLOCK_SCRIPT%\"\r", encoding::cmd_code_page()),
            Self::Python => concat!(
                "& { $env:PYTHONIOENCODING = 'utf-8'; ",
                "$p = Join-Path $PWD '.venv/Scripts/python.exe'; ",
                "if (Test-Path -LiteralPath $p -PathType Leaf) { & $p $env:VMARK_CODE_BLOCK_SCRIPT } ",
                "elseif ($p = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue) ",
                "{ & ($p.Source) -3 $env:VMARK_CODE_BLOCK_SCRIPT } else { ",
                "$p = Get-Command python.exe -All -CommandType Application -ErrorAction SilentlyContinue ",
                "| Where-Object { $_.Source -notlike '*\\Microsoft\\WindowsApps\\*' } | Select-Object -First 1; ",
                "if (!$p) { throw [IO.FileNotFoundException]::new('python.exe') }; ",
                "& ($p.Source) $env:VMARK_CODE_BLOCK_SCRIPT } }\r"
            ).into(),
        }
    }
}

impl CodeBlockRequest {
    fn prepare(&self, file: &str) -> Result<tempfile::TempPath, CommandError> {
        if !cfg!(target_os = "windows") {
            return Err(CommandError::unsupported(
                "Windows code blocks require Windows",
            ));
        }
        let name = std::path::Path::new(file)
            .file_name()
            .and_then(|name| name.to_str());
        if !name.is_some_and(|name| name.eq_ignore_ascii_case(self.shell.executable())) {
            return Err(CommandError::invalid_input(
                "Code block interpreter does not match its language",
            ));
        }
        let bytes = self.script_bytes()?;
        let suffix = match self.shell {
            CodeShell::PowerShell => ".ps1",
            CodeShell::Cmd => ".cmd",
            CodeShell::Python => ".py",
        };
        let mut file = tempfile::Builder::new()
            .prefix("vmark-code-")
            .suffix(suffix)
            .tempfile()
            .map_err(|error| CommandError::from_io(&error, "Cannot create code-block script"))?;
        file.write_all(&bytes)
            .map_err(|error| CommandError::from_io(&error, "Cannot write code-block script"))?;
        Ok(file.into_temp_path())
    }
    fn script_bytes(&self) -> Result<Vec<u8>, CommandError> {
        if self.source.trim().is_empty()
            || self.source.len() > 1024 * 1024
            || self.source.contains('\0')
        {
            return Err(CommandError::invalid_input(
                "Code block is empty, contains NUL, or exceeds 1 MiB",
            ));
        }
        Ok(match self.shell {
            CodeShell::PowerShell => [b"\xef\xbb\xbf".as_slice(), self.source.as_bytes()].concat(),
            CodeShell::Python => self.source.as_bytes().to_vec(),
            CodeShell::Cmd => encoding::encode_cmd(&format!(
                "@echo off\r\n{}\r\n",
                self.source
                    .replace("\r\n", "\n")
                    .replace('\r', "\n")
                    .replace('\n', "\r\n")
            ))?,
        })
    }
}

#[derive(Serialize)]
pub struct CodeBlockSpawn {
    pid: u32,
    command: String,
}

/// Spawn through the same vetted shell policy and session registry as a normal PTY.
#[tauri::command]
pub async fn pty_spawn_code_block(
    file: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    code_block: CodeBlockRequest,
    window: tauri::Window,
) -> Result<CodeBlockSpawn, CommandError> {
    let owner = window.label().to_string();
    let command_line = code_block.shell.command();
    let session = tokio::task::spawn_blocking(move || {
        let command = super::spawn_policy::vet(
            super::spawn_policy::ShellSource::system(),
            file.clone(),
            Vec::new(),
            env,
            |_| Ok(Vec::new()),
        )?;
        let script = code_block.prepare(&file)?;
        super::session::create_session_with_script(
            owner,
            command,
            cols,
            rows,
            cwd.as_deref(),
            Some(script),
        )
        .map_err(super::pty_io)
    })
    .await
    .map_err(|error| super::pty_internal("Code-block PTY spawn task failed", error))??;
    let state = window.state::<super::PtyState>();
    let pid = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.sessions.write().await.insert(pid, Arc::new(session));
    Ok(CodeBlockSpawn {
        pid,
        command: command_line,
    })
}

#[cfg(test)]
#[path = "code_block.test.rs"]
mod tests;
