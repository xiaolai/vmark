; VMark NSIS installer hooks — issue #1142.
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
; Writing to HKCR adapts to the install context: an elevated (per-machine)
; uninstaller resolves it to HKLM\Software\Classes (where the OS default lives
; and where the deletion happened); a per-user uninstaller resolves it to
; HKCU\Software\Classes (harmless — the machine-wide key was never touched).
;
; NOTE: authored on a macOS-primary dev machine and NOT yet verified against a
; real Windows build. Confirm the ShellNew entry is restored after a
; build → install → uninstall cycle on Windows before a release relies on this.
; Worst case it is a harmless redundant write.

!macro NSIS_HOOK_POSTUNINSTALL
  WriteRegStr HKCR ".txt\ShellNew" "NullFile" ""
!macroend
