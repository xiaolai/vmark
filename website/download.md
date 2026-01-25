# Download VMark

<script setup>
import DownloadButton from './.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## System Requirements

- macOS 10.15 (Catalina) or later
- Apple Silicon (M1/M2/M3) or Intel processor
- 200 MB disk space

## Installation

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

## Windows & Linux

VMark is built with Tauri, which supports cross-platform compilation. However, **active development and testing is currently focused on macOS**. Windows and Linux support is limited for the foreseeable future due to resource constraints.

If you'd like to run VMark on Windows or Linux:

- **Pre-built binaries** are available on [GitHub Releases](https://github.com/xiaolai/vmark/releases) (provided as-is, without guaranteed support)
- **Build from source** following the instructions below

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
