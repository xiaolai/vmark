// Renders what the Dock and Finder actually draw for a bundle (or any file):
// NSWorkspace's icon for the path, rasterised at 512 px. This is the only
// honest check for an app icon on macOS 26 — the system masks, shades and
// lights whatever the bundle provides, so inspecting the source bitmap tells you
// nothing about the seam or gutter the user sees. `scripts/build-macos-glass-
// icon.sh` and `dev-docs/icons.md` describe the two throwaway bundles worth
// rendering: one carrying Assets.car + CFBundleIconName (macOS 26 path) and one
// with only icon.icns (the fallback every older macOS uses).
//
//   swift scripts/render-dock-icon.swift /path/To.app /tmp/out.png
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: render-dock-icon.swift <path> <out.png>\n".data(using: .utf8)!)
    exit(64)
}
let icon = NSWorkspace.shared.icon(forFile: args[1])
let size = NSSize(width: 512, height: 512)
let img = NSImage(size: size)
img.lockFocus()
icon.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1.0)
img.unlockFocus()
guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not rasterise the icon\n".data(using: .utf8)!)
    exit(1)
}
try png.write(to: URL(fileURLWithPath: args[2]))
print("wrote \(args[2])")
