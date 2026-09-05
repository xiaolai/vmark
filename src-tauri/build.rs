fn main() {
    // tauri-build does not add icons/** to Cargo's input set, so without these
    // the binary keeps embedding the previous .icns after the icon is
    // regenerated: the new file is on disk, the old one is still in the Dock.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.svg");
    println!("cargo:rerun-if-changed=icons-dev");
    // The macOS 26 layered icon: the compiled catalogue that ships in the bundle
    // and the source it is built from (scripts/build-macos-glass-icon.sh).
    println!("cargo:rerun-if-changed=icons/Assets.car");
    println!("cargo:rerun-if-changed=icons/VMark.icon");
    println!("cargo:rerun-if-changed=Info.plist");
    tauri_build::build()
}
