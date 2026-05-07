# 支持的格式

VMark 可直接打开以下所有文件格式。其差异化之处在于**架构感知预览**：当文件是已知的制品时，VMark 会渲染*正确*的视图，而不是通用的 JSON 树。

[[toc]]

## 启用格式

Markdown、纯文本和 YAML/YML 始终以完整编辑器打开 —— 这是默认的稳定选项。以下所有其他格式**默认关闭**，需在 **设置 → 格式** 中按类别开启：

| 开关 | 启用内容 |
|---|---|
| **数据格式** | `.json`、`.jsonl`、`.toml`（分栏源码 + 树形视图，支持 Cargo / package.json / pyproject 架构渲染器） |
| **图表 & SVG** | `.mmd`、`.svg`（分栏源码 + 净化后的实时渲染） |
| **HTML 预览** | `.html`、`.htm`（沙盒 iframe —— 参见 [HTML 安全模型](#html-安全模型)） |
| **代码查看器** | 12 种只读代码查看器（`.ts`、`.tsx`、`.js`、`.jsx`、`.py`、`.rs`、`.go`、`.css`、`.sh`、`.bash`、`.rb`、`.lua`） |

当某类别关闭时，匹配的扩展名会回退到纯文本模式，文件仍然可以打开 —— 只是没有预览或架构视图。切换开关后，注册表即时重建；已打开的标签页会以正确的适配器重新挂载。

首次升级至多格式支持后启动时，VMark 会显示一次性提示，引导你前往 **设置 → 格式**。如果你已关闭提示（或全新安装），随时可在 **设置 → 格式** 中找到此面板。

## 格式一览

| 格式族 | 扩展名 | 默认状态 | 编辑器 | 预览 |
|---|---|---|---|---|
| Markdown | `.md`、`.markdown`、`.mdown`、`.mkd`、`.mdx` | 始终开启 | 所见即所得 + 源码模式 | 渲染后的正文 |
| 纯文本 | `.txt` | 始终开启 | 源码 | — |
| 数据 — YAML | `.yaml`、`.yml` | 始终开启 | 源码 + 树形 | 可导航树，支持架构感知（GitHub Actions） |
| 数据 — JSON | `.json`、`.jsonl` | 需开启**数据格式** | 源码 + 树形 | 可导航 JSON 树，支持架构感知（`package.json`） |
| 数据 — TOML | `.toml` | 需开启**数据格式** | 源码 + 树形 | 可导航树，支持架构感知（`Cargo.toml`、`pyproject.toml`） |
| 图表 | `.mmd` | 需开启**图表 & SVG** | 源码 + 渲染 | 实时 Mermaid 图表 |
| 矢量图 | `.svg` | 需开启**图表 & SVG** | 源码 + 渲染 | 净化后的内联渲染 |
| Web | `.html`、`.htm` | 需开启 **HTML 预览** | 源码 + 渲染 | 沙盒 iframe（空 `sandbox=""`、DOMPurify、CSP） |
| 代码（只读） | `.ts`、`.tsx`、`.js`、`.jsx`、`.py`、`.rs`、`.go`、`.css`、`.sh`、`.bash`、`.rb`、`.lua` | 需开启**代码查看器** | 查看器（可切换编辑） | — |

代码文件默认只读，并提供 **启用编辑** 和 **在外部编辑器中打开** 两个按钮。

## 架构感知预览

当路径或内容匹配已知架构时，VMark 会以合适的视图替换通用树形显示。

### GitHub Actions 工作流（`.github/workflows/*.yml`）

以工作流可视化方式打开（作业有向无环图、触发条件、权限）。

- **路径检测**：位于 `.github/workflows/` 下的 `.yml` / `.yaml` 文件会路由到工作流渲染器 —— 即使 YAML 格式有误，也会显示带诊断信息的降级视图，而不是空白树。（文件须先经过 YAML 适配器处理，因此需要 `.yml` / `.yaml` 扩展名。）
- **内容检测**：顶层 `on:` 和 `jobs:` 键。

### `Cargo.toml`

以 Rust 依赖树打开 —— 包含运行时、开发和构建依赖，以及版本规格和功能标志。

- **路径检测**：在 POSIX 或 Windows 路径中，文件名为 `Cargo.toml`（不区分大小写）。
- **内容检测**：`[package]` 或 `[workspace]` 头部。
- **无网络请求** —— VMark 从不解析 crates.io。

### `package.json`

以 npm 依赖树打开 —— `dependencies`、`devDependencies`、`peerDependencies`、`optionalDependencies`。

- **路径检测**：文件名为 `package.json`。
- **内容检测**：顶层 `name` 加上 `dependencies` / `devDependencies` / `peerDependencies` 中的任意一项。

### `pyproject.toml`

以 Python 依赖树打开 —— 同时支持 PEP 621（`[project]` + `[project.optional-dependencies]`）和 Poetry（`[tool.poetry.dependencies]`、`[tool.poetry.dev-dependencies]`、`[tool.poetry.group.<name>.dependencies]`）。

- **路径检测**：文件名为 `pyproject.toml`。
- **内容检测**：`[project]` 或 `[tool.poetry]` 头部（需通过 TOML 解析）。

## 编辑规则

- **Markdown** 提供完整的工具栏、段落格式化、中日韩规则、数学公式、Mermaid、脚注 —— 所有现有 Markdown 功能。
- **数据格式**（JSON、YAML、TOML）在源码窗格中显示解析错误的行号标记；树形预览随输入实时更新。仅适用于 Markdown 的菜单操作已禁用（中日韩格式化、插入块、段落格式化）；与当前模式相关的控件保持可用。
- **可视化格式**（Mermaid、SVG、HTML）在源码窗格中显示，右侧窗格显示渲染视图（防抖更新）。
- **代码格式**以带语法高亮的查看器打开；可切换为就地编辑，或在外部编辑器中打开（见下文）。

## 查找、保存、内容搜索

- **Cmd+O** 过滤器：单一"所有支持格式"预设，涵盖所有已注册格式。另存为过滤器和默认保存扩展名由活动标签页的格式适配器决定，因此保存 `.toml` 文件时会建议使用 `.toml` 扩展名。
- **拖放**接受任何已注册的扩展名。
- **另存为**的过滤器和默认扩展名由活动标签页的格式适配器决定。
- **Cmd+Shift+H** 内容搜索（"在文件中查找"）可索引所有文本类格式（Markdown、txt、json、yaml、toml、html、svg、mermaid）。代码文件默认排除 —— 因为它们处于代码查看器模式。

## HTML 安全模型

根据多格式计划中的 ADR-4，HTML 预览依赖三个独立的防御层：

1. **`<iframe sandbox="">`**，空允许列表 —— 无脚本、无同源、无表单、无弹窗。沙盒通过 iframe 属性本身强制执行（根据 MDN，`<meta>` 中的 CSP 不等同于沙盒）。
2. **DOMPurify 净化**先于其他步骤运行 —— 剥离 `<script>`、`javascript:` URL、内联事件处理器和 base-href 技巧。
3. **CSP `<meta>` 注入** —— `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none';` —— 限制 iframe 内部的资源加载。

验证器会将脚本标签、`javascript:` URL 和内联事件处理器显示为警告，让你清楚哪些内容被阻止了。

## 在外部编辑器中打开

对于代码文件，只读横幅上的 **在外部编辑器中打开** 按钮会启动你选择的编辑器。解析顺序：

1. **设置 → 格式 → 外部编辑器**（图形界面字段 —— 参见[设置](/zh-CN/guide/settings#格式)）。在 macOS 上选择 `.app` 应用包，在 Linux/Windows 上选择可执行文件，或任何 Shell 可解析的路径。
2. `$VMARK_EXTERNAL_EDITOR`（项目级环境变量覆盖）
3. `$VISUAL`
4. `$EDITOR`
5. 平台默认（macOS 上的 `open -t`、Windows 上的 `notepad.exe`、Linux 上的 `xdg-open`）

图形界面设置优先于环境变量 —— 显式优于隐式。留空则使用环境变量回退链。

VMark 通过登录 Shell 的 PATH 进行路由，因此从 macOS 图形界面应用启动时，VS Code / Cursor / JetBrains 的包装程序也能正确解析。

### 安全关口

`open_in_external_editor` Tauri 命令会拒绝以下情况：

- 不存在的路径
- 目录和其他非普通文件（套接字、设备）
- 规范化扩展名不在 VMark 已注册格式集中的路径
- 其规范化目标未通过上述任何检查的符号链接

即使 webview 遭到入侵，也无法通过此按钮在任意系统文件（密码、密钥等）上启动外部编辑器 —— 只能对 VMark 本身可打开的路径操作。

## 暂不支持的内容

根据计划的非目标：

- **不是代码编辑器。** 无 LSP、无自动补全、无重构、无调试器、无 git 边距标记。
- **不是"所有纯文本格式"。** 范围有限 —— 参见上方表格。
- **不执行 HTML 脚本。** 仅提供沙盒渲染。
- **v1 版本不支持非 Markdown 格式的打印 / 导出 / 复制为 HTML。**
- **代码查看器暂不支持**：Zig、Swift、Kotlin、Java、Elixir、OCaml 以及 12 个扩展名以外的其他语言。决策原则是"我们自己使用的语言" —— 如需添加，欢迎提交 issue。

如果你需要的格式未列出，且不在明确的非支持范围内，欢迎提交 issue。
