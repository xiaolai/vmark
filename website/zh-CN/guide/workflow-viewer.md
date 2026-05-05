# GitHub Actions 工作流查看器

VMark 把 GitHub Actions 工作流 YAML 渲染成一张可交互的有向无环图（DAG），并允许你通过结构化表单编辑 jobs、steps 和 triggers —— 整个过程不会丢失底层文件中的注释、锚点或格式。

该功能在两个场景下都可用：

1. **独立的 `.yml` 文件**，位于 `.github/workflows/` 下（或任何顶层结构能被识别为 workflow 的文件）：分屏视图，左侧是源码，右侧是可交互画布加上结构化编辑器。
2. **Markdown 中的代码围栏**：当一个三反引号 `yaml` 或 `yml` 围栏块中含有可识别的 workflow 时，VMark 会像渲染 `mermaid` 块那样，将其渲染为内联的 Mermaid 风格 DAG。

## 独立 workflow 文件

在 VMark 中打开任意 `.github/workflows/*.yml` 文件。右侧面板会自动展开，显示：

- 整份 workflow 以可交互的 React Flow 画布呈现（jobs 是节点，`needs:` 依赖是边）。
- 画布下方是结构化编辑器面板。
- 编辑器顶栏包含 Save / Discard 控件。

在画布中点击一个 job 即可编辑它。点击 job 内的某个 step，即可编辑该 step。

### Job 编辑

可编辑字段：

| 字段 | Patch 类型 |
|------|-----------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

只读概览：step 数量、`needs:`、`uses:`（用于可重用工作流类型的 job）。

### Step 编辑

可编辑字段：

| 字段 | Patch 类型 |
|------|-----------|
| `name` | `step.set` |
| `run`（用于 run 类型的 step） | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` 中的键 | `with.set` / `with.remove` |

`with:` 块以"键/值"行的增/改/删形式呈现。重命名一个键时，VMark 会先对旧键发出 `with.remove`，再对新键发出 `with.set`。

对 `uses:` 类型的 step，action 引用本身是只读的 —— 想换成另一个 action，请直接在源码中改。

### Triggers

触发器概览（事件、branches、tags、paths、cron、types）在当前版本是只读的。通过单行输入框编辑密集的触发器结构损耗太大；在专门的选择器上线之前，请直接在源码里编辑触发器。

## 保存编辑

每改一个字段，编辑都会进入一个内存中的 patch 列表排队。Save 按钮会显示当前数量（例如 **3 unsaved**）。

点击 Save 时，VMark 会：

1. 从编辑器中读取当前 YAML。
2. 将所有排队的 patch 应用到 YAML 的 CST（具体语法树）上 —— 保留注释、锚点和原有格式。
3. 把结果写回编辑器，就像你自己手敲了一样。

文件随后进入常规的"已修改"状态；按 **Cmd+S** 写盘。

### 保留格式

默认的保存路径会让每个 patch 走 `yaml` 包的 CST API —— 注释、锚点节点、自定义缩进，以及原本的 flow 与 block 风格选择都会被保留。

如果你希望得到规范化重新格式化后的输出，请在 设置 → 高级 中关闭 **保存时保留 YAML 格式**。重新格式化路径会丢掉注释，所以这是显式开启的选项。

## Markdown 中的代码围栏

在 YAML 代码围栏中输入一份 workflow：

````markdown
```yaml
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test
```
````

VMark 会识别 workflow 的形态（顶层有 `jobs:`，每个 job 都有 `runs-on`），并以内联方式渲染图表。该图表是只读的 —— 想改 workflow，请编辑源码。

## 诊断信息

VMark 会在源码旁边展示解析与 lint 诊断：

| 代码前缀 | 含义 |
|----------|------|
| `GHA-PARSE-*` | YAML 格式错误或缺少必需键 |
| `GHA-JOB-*` | Job 级别问题（重复 id、`uses:` 与 `steps:` 同时存在等） |
| `GHA-NEEDS-*` | 依赖问题（未知引用、循环依赖） |
| `GHA-STEP-*` | Step 级别问题 |
| `GHA-EXPR-*` | 未知的上下文引用 |
| `GHA-MATRIX-*` | 矩阵展开问题 |
| `GHA-SEC-*` | 安全警告（例如 `pull_request_target` 中的 checkout 模式） |
| `GHA-ACTIONLINT-*` | 已安装时由 `actionlint` 转发而来的诊断 |

安装 `actionlint`，并在 设置 → 高级 中开启 **可用时使用 actionlint**，即可获得更丰富的表达式诊断。

## Action 元数据

对于引用了公共 GitHub Action 的 `uses:` step，VMark 可以拉取每个 action 的 `action.yml`，把输入项的描述填入结构化编辑器。该选项默认关闭，启用后会在本地缓存 24 小时。

在 设置 → 高级 中切换 **拉取 action 元数据**。关闭后，所有 action 引用都保持纯文本 —— 不发起任何网络请求。

## 导出

工作流侧边面板的顶栏菜单里有三种导出方式：

| 格式 | 适用场景 |
|------|---------|
| **Mermaid** | 嵌入 README 等 Markdown 文档。有损：会丢掉运行状态、action 图标、自定义徽章和矩阵展开细节。 |
| **SVG** | 嵌入需要矢量图形的文档。HTML 内容通过 `foreignObject` 渲染。 |
| **PNG** | 在不支持 SVG 的聊天工具或其他场景中分享。按画布当前缩放级别渲染。 |

## 它不是什么

VMark 不会执行 GitHub Actions 工作流。它只是一个查看器和编辑器 —— 执行依旧是 GitHub 的事。整套功能只面向阅读、审阅和编写 workflow YAML。
