; VMark NSIS installer hooks.
;
; Both repairs below run from NSIS_HOOK_POSTUNINSTALL, which Tauri inserts at
; the END of the uninstall section — after the APP_UNASSOCIATE loop that undoes
; the file associations. That ordering is what makes a repair possible; see
; crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi (the unassociate
; loop, then the hook a few dozen lines later).
;
; ---------------------------------------------------------------------------
; 1. Re-create HKCR\.txt\ShellNew — issue #1142
; ---------------------------------------------------------------------------
;
; VMark registers a ".txt" file association (see fileAssociations in
; tauri.conf.json). Windows' NSIS uninstaller cleanup for that association
; removes HKEY_CLASSES_ROOT\.txt\ShellNew — a key that belongs to Windows, not
; VMark. That key (with its "NullFile" value) is what drives the
; "New > Text Document" entry in the desktop/Explorer right-click menu for EVERY
; application, so uninstalling VMark silently broke it system-wide.
;
; We keep the ".txt" association and repair the damage here instead: this
; POSTUNINSTALL hook runs AFTER Tauri's association cleanup and re-creates the
; OS-default ShellNew template. NullFile="" is exactly what Windows ships.
;
; VERIFIED on Windows for the first time on 2026-09-09, against v0.9.67:
; cycle 2 of the release-smoke Windows job deletes ShellNew from BOTH hives
; before uninstalling, so its presence afterwards can only mean this write
; landed — and it was present. Run 34313339017,
; "after uninstall (cycle 2): restored by the POSTUNINSTALL hook".
;
; That closes the caveat this header carried from the day it was written: the
; hook was authored on a macOS-primary machine and, until that run, had never
; executed on Windows at all. The v0.9.66 run could not reach cycle 2 — it
; failed in cycle 1 on the separate defect below.
;
; ---------------------------------------------------------------------------
; 2. Drop the empty ProgID the association cleanup leaves behind
; ---------------------------------------------------------------------------
;
; Found by the release-smoke Windows job on v0.9.66, its first ever run:
;
;     HKCR\.txt (default) before: 'txtfile'
;     uninstall changed the .txt association: 'txtfile' -> ''
;
; Tauri's macros back up the previous ProgID by reading from the SAME hive they
; write to (FileAssociation.nsh):
;
;     APP_ASSOCIATE:    ReadRegStr  $R0 SHELL_CONTEXT "Software\Classes\.txt" ""
;                       WriteRegStr     SHELL_CONTEXT "Software\Classes\.txt" "txt_backup" "$R0"
;     APP_UNASSOCIATE:  ReadRegStr  $R0 SHELL_CONTEXT "Software\Classes\.txt" "txt_backup"
;                       WriteRegStr     SHELL_CONTEXT "Software\Classes\.txt" "" "$R0"
;
; VMark installs per-user, so SHELL_CONTEXT is HKCU — but the machine-wide
; "txtfile" association lives in HKLM. The backup therefore records "", and the
; uninstaller writes that empty string back UNCONDITIONALLY. HKEY_CLASSES_ROOT
; is a merged view in which HKCU wins, so an empty default value sitting in HKCU
; SHADOWS the real HKLM one: after uninstalling VMark, .txt had no ProgID.
;
; A per-machine install does not have the bug — there the backup reads the hive
; the value actually lives in and restores it correctly. The defect is specific
; to the per-user mode VMark ships.
;
; Deleting the value (rather than writing HKLM's ProgID into HKCU) is what
; restores the previous state, and the same run proves the fall-through works:
; after the install, HKCU\Software\Classes\.txt existed and had no ShellNew
; subkey, yet "after install: HKCR\.txt\ShellNew\NullFile present" still passed
; — so HKCR merges per ENTRY, and an entry absent from HKCU resolves to HKLM.
; Writing a copied ProgID instead would leave a stale duplicate behind that no
; later uninstall owns.
;
; Only an EMPTY default is removed. A non-empty one means either the restore
; genuinely worked (per-machine install) or another application has since
; claimed the extension; in both cases the value is not ours to touch. The
; "<ext>_backup" value is deliberately LEFT in place: Tauri derives the file
; class from the bare extension when a fileAssociation declares no "name", so
; that value name is not unique to VMark and deleting it could break another
; Tauri app's own restore. It is inert — with no default value present, the
; merged view falls through to HKLM regardless.
;
; Both hives are repaired because SHCTX is not reliable at this point: the
; uninstall section runs "SetShellVarContext current" a few lines before the
; hook when the user ticks "delete application data". Repairing both is
; idempotent and cannot lose information — an empty default carries none.
;
; This must cover EVERY extension in tauri.conf.json's fileAssociations, not
; just .txt: .html, .htm, .svg and .json all commonly have machine-wide
; handlers to shadow. scripts/release-smoke-windows-installer.test.mjs reads
; that list and fails if an extension is missing from the macro below, so a new
; association cannot silently reintroduce this.

!macro VMARK_UNSHADOW_ASSOCIATION EXT
  Push $R0

  ReadRegStr $R0 HKCU "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue HKCU "Software\Classes\.${EXT}" ""
  ${EndIf}

  ReadRegStr $R0 HKLM "Software\Classes\.${EXT}" ""
  ${If} $R0 == ""
    DeleteRegValue HKLM "Software\Classes\.${EXT}" ""
  ${EndIf}

  Pop $R0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  WriteRegStr HKCR ".txt\ShellNew" "NullFile" ""

  ; Keep in sync with fileAssociations in src-tauri/tauri.conf.json.
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "md"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "markdown"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mdown"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mkd"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mdx"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "txt"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "json"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "jsonl"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "yaml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "yml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "toml"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "mmd"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "svg"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "html"
  !insertmacro VMARK_UNSHADOW_ASSOCIATION "htm"
!macroend
