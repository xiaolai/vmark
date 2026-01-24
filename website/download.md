# Download VMark

Get VMark for your platform. All versions include the same features - choose the installer that matches your operating system.

<script setup>
import DownloadButton from './.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## System Requirements

### macOS

- macOS 10.15 (Catalina) or later
- Apple Silicon (M1/M2/M3) or Intel processor
- 200 MB disk space

### Windows

- Windows 10 (version 1803) or later
- 64-bit processor
- 200 MB disk space

### Linux

- Ubuntu 20.04 or later / Fedora 36 or later / other modern distributions
- 64-bit processor
- 200 MB disk space
- WebKit2GTK 4.1 (usually pre-installed on GTK-based desktops)

## Installation

### macOS

**Homebrew (Recommended)**

```bash
brew install xiaolai/tap/vmark
```

This installs VMark and automatically selects the right version for your Mac (Apple Silicon or Intel).

**Upgrading**

```bash
brew update && brew upgrade vmark
```

**Manual Installation**

1. Download the `.dmg` file
2. Open the downloaded file
3. Drag VMark to your Applications folder
4. On first launch, right-click the app and select "Open" to bypass Gatekeeper

### Windows

1. Download the `.msi` installer
2. Run the installer and follow the prompts
3. VMark will be available in your Start menu

### Linux

**AppImage (Universal):**
1. Download the `.AppImage` file
2. Make it executable: `chmod +x VMark*.AppImage`
3. Run it: `./VMark*.AppImage`

**Debian/Ubuntu (.deb):**
```bash
sudo dpkg -i vmark_*.deb
```

**Fedora/RHEL (.rpm):**
```bash
sudo rpm -i vmark-*.rpm
```

## Verifying Downloads

All releases are built automatically via GitHub Actions. You can verify the authenticity by checking the release on our [GitHub Releases page](https://github.com/xiaolai/vmark/releases).

## Building from Source

For developers who want to build VMark from source:

```bash
# Clone the repository
git clone https://github.com/xiaolai/vmark.git
cd vmark

# Install dependencies
pnpm install

# Build for production
pnpm tauri build
```

See the [README](https://github.com/xiaolai/vmark#readme) for detailed build instructions and prerequisites.
