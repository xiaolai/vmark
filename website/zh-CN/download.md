# 下载 VMark

<script setup>
import DownloadButton from '../.vitepress/components/DownloadButton.vue'
</script>

<DownloadButton />

## 系统要求

- macOS 13.4 (Ventura) 或更高版本
- Apple Silicon (M1/M2/M3) 或 Intel 处理器
- 200 MB 磁盘空间

::: info 为什么需要 macOS 13.4？
VMark 使用 macOS 自带的 WebKit 引擎绘制界面，因此可用的网页特性由 macOS 版本决定。macOS 13.4 是内置 WebKit 能够运行当前版本的最早系统。

此页面此前写的是 10.15。那个数字从来都不准确——它只是一个没人核实过的默认值，而在更旧的系统上，VMark 不会拒绝启动，而是打开一个空白窗口。低于 13.4 时，macOS 自己会拒绝打开 VMark 并说明原因，而不是留给你一个空白窗口。
:::

## 安装方式

**Homebrew（推荐）**

```bash
brew install xiaolai/tap/vmark
```

这将安装 VMark 并自动为你的 Mac 选择正确的版本（Apple Silicon 或 Intel）。

**升级**

```bash
brew update && brew upgrade vmark
```

**手动安装**

1. 下载 `.dmg` 文件
2. 打开下载的文件
3. 将 VMark 拖入应用程序文件夹
4. 首次启动时，右键点击应用并选择"打开"以绕过 Gatekeeper

## Windows 和 Linux

VMark 基于 Tauri 构建，支持跨平台编译。但 **目前活跃的开发和测试专注于 macOS**。由于资源有限，在可预见的未来，Windows 和 Linux 支持程度有限。

如果你想在 Windows 或 Linux 上运行 VMark：

- **预编译二进制文件** 可在 [GitHub Releases](https://github.com/xiaolai/vmark/releases) 页面获取（按现状提供，不保证支持）
- **从源码构建**，请按照以下说明操作

## 验证下载

所有版本均通过 GitHub Actions 自动构建。你可以通过查看 [GitHub Releases 页面](https://github.com/xiaolai/vmark/releases) 上的发布记录来验证其真实性。

## 从源码构建

开发者如需从源码构建 VMark：

```bash
# 克隆仓库
git clone https://github.com/xiaolai/vmark.git
cd vmark

# 安装依赖
pnpm install

# 构建生产版本
pnpm tauri build
```

详细的构建说明和前置条件请参阅 [README](https://github.com/xiaolai/vmark#readme)。
