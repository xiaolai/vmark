# GitHub Actions 工作流查看器

VMark 把 GitHub Actions 工作流 YAML 渲染成一张可交互的有向无环图（DAG），并允许你通过结构化表单编辑 jobs、steps、triggers、permissions 和 concurrency —— 整个过程不会丢失底层文件中的注释、锚点或格式。

该功能在两个场景下都可用：

1. **独立的 `.yml` 文件**，位于 `.github/workflows/` 下（或任何顶层带有 `on:` 和 `jobs:` 键的 YAML 文件）：分屏视图，左侧是源码，右侧是可交互画布加上表单编辑器。
2. **Markdown 中的代码围栏**：当一个三反引号 `yaml` 或 `yml` 围栏块中含有可识别的 workflow 时，VMark 会像渲染 `mermaid` 块那样，把同一张 job 图以图片形式内联渲染出来。

::: tip 不同于 VMark 自己的工作流
顶层 `steps:` 使用 `genie/…` 或 `action/…` 的 YAML 文件是 [Genie 工作流](/zh-CN/guide/workflows) —— VMark 自己的流水线格式，VMark 可以运行它。GitHub Actions workflow 在这里只能查看和编辑；参见[它不是什么](#它不是什么)。
:::

## 独立 workflow 文件

在 VMark 中打开任意 `.github/workflows/*.yml` 文件。文件会以分屏视图打开 —— 左侧是 YAML 源码，右侧是 workflow 工作台（Source / Split / Preview 切换按钮用于切换布局）。工作台显示：

- 整份 workflow 以可交互的 React Flow 画布呈现（jobs 是节点，`needs:` 依赖是边）。画布的控制条可以缩放、让整张图适配窗格，并在从上到下与从左到右两种布局之间切换 —— 在较宽的窗格中查看很长的 `needs:` 链时很方便。
- 画布右上角的导出控件（参见[导出](#导出)）。
- 画布下方的结构化编辑器面板：[诊断信息](#诊断信息)横幅、Save / Discard 控件、workflow 级表单，以及当前选中的 job 或 step 的表单。

在画布中点击一个 job 即可编辑它。点击 job 内的某个 step，即可编辑该 step。按 Escape 会清除选择，并把焦点交回源码。

编辑源码时，VMark 会让两个窗格保持同步：把光标移入某个 job 所在的行，会在画布上高亮它的节点；`${{ }}` 表达式会根据解析出的 workflow 上下文自动补全；按住 Cmd 点击本地的 `uses:` 引用会打开目标文件。

### Job 编辑

可编辑字段：

| 字段 | Patch 类型 |
|------|-----------|
| `name` | `job.set` |
| `runs-on` | `job.set` |
| `if` | `job.set` |

只读概览：step 数量、`needs:`、`uses:`（用于可重用工作流类型的 job）。

表单上方的 **Add job** 会用你输入的 ID 新建一个 job —— ID 必须以字母或下划线开头，且不能与已有 job 重复 —— 新 job 在你修改之前运行在 `ubuntu-latest` 上。job 表单中的删除按钮会在你确认后删除当前选中的 job。

job 表单还会列出该 job 的所有 step。每一行都可以上移、下移或删除（删除前需确认），**Add step** 会追加一个 `run: echo TODO` 形式的新 step，供你继续编辑。

### Step 编辑

可编辑字段：

| 字段 | Patch 类型 |
|------|-----------|
| `name` | `step.set` |
| `run`（用于 run 类型的 step） | `step.set` |
| `working-directory` | `step.set` |
| `if` | `step.set` |
| `with:` 中的键 | `with.set` / `with.remove` |

`with:` 块以"键/值"行的增/改/删形式呈现。重命名一个键时，VMark 会先对旧键发出 `with.remove`，再对新键发出 `with.set`。如果某个键已被另一行使用，会在该行内直接拒绝。

对 `uses:` 类型的 step，action 引用本身是只读的 —— 想换成另一个 action，请直接在源码中改。

在 step 表单中，**Alt + Left** / **Alt + Right** 可移到上一个 / 下一个 step。该快捷键在窗口内任何位置都有效，但在文本框、下拉选择框或代码编辑器中除外——在那里 Alt + 方向键保留其按单词移动的常规含义。

### Triggers

以映射形式书写的触发器（`on: { push: { branches: [main] } }`）带有可编辑的过滤字段 —— branches、branches-ignore、tags、tags-ignore、paths、paths-ignore 和 types，每一项都是逗号分隔的列表。`schedule` 的 cron 会显示为一句界面语言的描述（星期和月份名称仍保留为英文三字母缩写，如 `Mon`、`Jan`），运行频率高于每 5 分钟一次时会给出警告（GitHub 会对这类任务限流），且为只读。只写了一个事件名、或写成事件名列表的触发器同样是只读的；请在源码中编辑它们。

### Permissions 和 concurrency

job 表单上方有两个 workflow 级表单：

- **Permissions** —— GitHub 的默认值（没有 `permissions:` 键）、`read-all`、`write-all`、`none`，或按作用域逐项设置的表格（`contents`、`pull-requests`、…），每项可选 read / write / none。
- **Concurrency** —— `group`，以及是否 `cancel-in-progress`。以表达式书写的 `cancel-in-progress` 会显示出来，但不能在这里编辑。

## 保存编辑

每改一个字段，编辑都会进入一个内存中的 patch 列表排队。Save 按钮会显示当前数量（例如 **3 unsaved**），新增的 job 和 step 在保存之前就已经出现在画布和表单中。

点击 Save 时，VMark 会：

1. 从编辑器中读取当前 YAML。
2. 将所有排队的 patch 应用到 YAML 的 CST（具体语法树）上 —— 保留注释、锚点和原有格式。
3. 对于磁盘上的文件，把结果写入该文件，再让编辑器与之保持一致 —— 除非你在此期间在源码中输入过内容，那样会保留你输入的内容。

如果写入失败，不会丢失任何内容：编辑仍在队列中，你可以再次保存。未命名文档没有可写入的文件，因此 Save 只更新编辑器；按 **Cmd+Shift+S** 保存它。**Discard** 会丢弃排队中的编辑。

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

VMark 会识别 workflow 的形态（顶层有 `on:` 和 `jobs:` 键），并以内联方式渲染出它的 job 图 —— 与独立视图相同的画布，捕获为一张图片。该图片是只读的；双击它即可编辑源码。

## 诊断信息

VMark 会在表单面板顶部的横幅中展示解析与 lint 诊断。点击某一行会让源码跳到出问题的那一行；当无法定位到行时（例如在 Preview 模式下），则会选中出问题的 job：

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

安装 `actionlint` 可获得更丰富的表达式诊断。在 设置 → 高级（工作流文件）中开启 **可用时使用 actionlint**（默认开启）后，每当 workflow 文件的源码发生变化，VMark 都会从你的登录 shell PATH 中运行该可执行文件，并把它的结果追加到工作台的诊断横幅中，标记为 `GHA-ACTIONLINT-<rule>`；上面的内置检查从不等待它。如果开关已开启但未安装该可执行文件，VMark 每个会话只提示一次，其余时候保持安静；如果可执行文件存在却运行失败，会用 actionlint 自己的消息报告一次。关闭该开关即可完全跳过 actionlint。MCP 的 `workflow.validate` 操作会按需运行同样的检查。

## Action 元数据

对于引用了公共 GitHub Action 的 `uses:` step，VMark 会拉取每个 action 的 `action.yml`，把输入项的描述填入结构化编辑器。结果会在磁盘上缓存 24 小时。工作区本地的 action（`./…`）直接从磁盘读取，从不访问网络。

要让 workflow 编辑器完全离线，请在 设置 → 高级（工作流文件）中关闭 **获取 Action 元数据** —— 关闭后不会发起任何网络请求，`with:` 表单会退回为自由填写的键/值行。

## 导出

画布右上角的导出控件提供三种格式：

| 格式 | 适用场景 |
|------|---------|
| **Mermaid** | 嵌入 README 等 Markdown 文档。会复制到剪贴板。有损：会丢掉运行状态、action 图标、自定义徽章和矩阵展开细节。 |
| **SVG** | 嵌入需要矢量图形的文档。HTML 内容通过 `foreignObject` 渲染。 |
| **PNG** | 在不支持 SVG 的聊天工具或其他场景中分享。按画布当前缩放级别渲染。 |

## 它不是什么

VMark 不会执行 GitHub Actions 工作流。它只是一个查看器和编辑器 —— 执行依旧是 GitHub 的事。整套功能只面向阅读、审阅和编写 workflow YAML。VMark 自己可运行的流水线是另一种格式：参见 [Genie 工作流](/zh-CN/guide/workflows)。
