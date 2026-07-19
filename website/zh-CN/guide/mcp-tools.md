# MCP 工具参考

VMark 向 AI 助手暴露 **七个复合 MCP 工具**：`session`、`workspace`、`document`、`workflow`、`selection`、`browser` 和 `coherence`。它们合计涵盖编辑器读写主轴、文件与窗口生命周期、对 GitHub Actions YAML 进行 CST 安全的编辑、针对选区的精准编辑、受限的浏览器导航，以及对工作区一致性层的只读视图。

之前的 12 工具 / 76 操作接口已被精简，因为文档内的格式化工具（粗体、标题、表格等）与 AI 智能体通过 Markdown 往返已经能轻松完成的工作重复。完整的设计取舍参见 [MCP 精简方案](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)。

::: tip 推荐工作流
1. 调用一次 `session.get_state`，即可看到所有打开的窗口、标签页，以及每个标签页的 `{filePath, dirty, revision, kind}`。
2. 对 Markdown 文档：`document.read` → 推理 → `document.write`（传入 `expected_revision` 以保证并发安全）。
3. 对 GitHub Actions YAML（`kind: "yaml-workflow"`）：用 `workflow.apply_patch` 进行 CST 安全的编辑，保留注释和锚点；用 `workflow.validate` 获取 actionlint 诊断。
4. 文件操作（打开、保存、关闭、切换标签页）归 `workspace` 管。
:::

::: tip Mermaid 图表
通过 MCP 使用 AI 生成 Mermaid 时，建议安装 [mermaid-validator MCP 服务器](/zh-CN/guide/mermaid#mermaid-验证器-mcp-服务器语法检查) —— 它使用与 VMark 同款的 Mermaid v11 解析器，在图表进入文档前先捕获语法错误。
:::

---

## `session`

一次性定位。一次调用即可发现所有窗口、所有标签页，以及服务器的能力。

### `get_state`

无参数。

**返回** `{windows, capabilities}`：

```json
{
  "windows": [
    {
      "label": "main",
      "focused": true,
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown"
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow"
        }
      ]
    }
  ],
  "capabilities": {
    "version": "<vmark-mcp-server version>",
    "supportedKinds": ["markdown", "yaml-workflow"],
    "mcpProtocol": "0.2.0"
  }
}
```

`kind` 判别字段告诉你应该对该标签页使用 `document.write`（对应 markdown）还是 `workflow.apply_patch`（对应 yaml-workflow）。

---

## `workspace`

文件与窗口生命周期。不涉及文档内部内容。

### `new`

新建一个未命名标签页。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 否 | `"markdown"`（默认）或 `"yaml-workflow"` |
| `windowLabel` | string | 否 | 目标窗口；默认是当前聚焦窗口 |

返回 `{tabId}`。

### `open`

从磁盘打开一个文件。

| 参数 | 类型 | 必填 |
|------|------|------|
| `filePath` | string | 是 |
| `windowLabel` | string | 否 |

返回 `{tabId}`。

### `save`

将标签页保存到它现有的路径。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否（默认是当前聚焦的标签页） |

返回 `{filePath, revision}`。

### `save_as`

将标签页保存到一个新路径。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `filePath` | string | 是 |

返回 `{revision}`。

### `close`

关闭一个标签页。如果没有 `force`，拒绝丢弃未保存的改动。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 是 |
| `force` | boolean | 否 |

成功时返回 `{closed: true}`；若标签页处于脏状态而未提供 `force`，则返回 `{closed: false, reason: "DIRTY"}`。

### `switch_tab`

激活一个标签页。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 是 |

### `focus_window`

聚焦一个窗口。

| 参数 | 类型 | 必填 |
|------|------|------|
| `windowLabel` | string | 是 |

---

## `document`

读取、写入、转换。整个接口的主轴。

### `read`

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否（默认是当前聚焦的标签页） |

返回 `{content, revision, filePath, kind, dirty}`。写入前一定要先读 —— `revision` 令牌必须随后续的 `write` 一起传入。

### `write`

替换整篇文档内容。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tabId` | string | 否 | 目标标签页（默认聚焦的） |
| `content` | string | 是 | 新的完整内容 |
| `expected_revision` | string | 否 | 来自最近一次读取的 revision 令牌 |

如果传入了 `expected_revision`，而文档自那次读取后已经发生变化，响应将是带 `STALE` 的结构化错误信封，并附上当前的 revision；请重新读取后再试。

```json
// 成功
{ "revision": "rev-newAfterWrite" }

// 过期
{ "error": "STALE", "message": "Document has changed since the last read", "current_revision": "rev-currentNow" }
```

### `transform`

应用一次确定性的重写。目前支持 CJK 专用的转换（全角 ↔ ASCII 标点转换、CJK ↔ 拉丁的间距处理）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tabId` | string | 否 | 目标标签页 |
| `kind` | string | 是 | `"cjk-format"`、`"cjk-spacing"` 或 `"cjk-punctuation"` |
| `expected_revision` | string | 否 | 并发令牌 |

`cjk-format` 会按用户的 CJK 排版设置整篇执行一遍。`cjk-spacing` 在 CJK 字符与相邻拉丁字母 / 数字之间插入单个空格。`cjk-punctuation` 把贴在 CJK 字符旁边的 ASCII 标点转换为对应的全角形式。

返回 `{revision}`。

---

## `workflow`

针对 GitHub Actions 工作流 YAML 的 `actionlint` 校验，以及 **CST 安全的精准编辑**。仅对 `kind` 为 `"yaml-workflow"` 的标签页可用。

::: info `document.read` / `document.write` 对所有标签页都有效 —— 包括 workflow YAML
`workflow` 工具 **不是** 用来取代读写主轴的。对一个 workflow 标签页，你可以：

- 用 `document.read` 获取原始 YAML 文本（包括所有注释）
- 用 `document.write` 整体替换它（你发什么字符串就原样存什么 —— 只要你自己在内容里包含了注释，注释就会保留）
- 用 `workflow.apply_patch`，**让服务器自身去保证** 在局部编辑中注释、锚点和键的顺序都得以保留

只想改一个字段、其余都不动时用 `apply_patch`（服务器无法删掉它没改过的注释）。整体重写或从零生成新 workflow 时用 `document.write`。
:::

### `apply_patch`

应用一组 `IRPatch` 对象。补丁会经过 VMark 的 CST 感知变更器分发，从而保留注释、锚点以及键的顺序。对 YAML 文件直接 `document.write` 会丢掉这些信息。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `patches` | IRPatch[] | 是 |
| `expected_revision` | string | 否 |

`IRPatch` 是一个判别联合（以 `kind` 字段区分）。支持的 kind：

| `kind` | 效果 |
|---|---|
| `workflow.set` | 设置顶层字段（`{path, value}`） —— `name`、`env.X` 等 |
| `job.set` | 在某个 job 上设置字段（`{jobId, path, value}`） |
| `step.set` | 在某个 step 上设置字段（`{jobId, stepIndex, path, value}`） |
| `with.set` | 在某个 step 的 `with:` 块中设置一个键（`{jobId, stepIndex, key, value}`） |
| `with.remove` | 从某个 step 的 `with:` 块中移除一个键 |
| `needs.add` / `needs.remove` | 向 `needs:` 中加入或移除一个 job ID |
| `trigger.setFilters` | 替换某个触发器的过滤数组 —— branches、paths、types 等（`{event, filter, value: string[]}`） |

成功时返回 `{revision}`，否则返回结构化的 `STALE` / `INVALID_PATCH` / `NOT_WORKFLOW` 错误信封。

### `validate`

对 workflow YAML 运行 `actionlint`。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否 |

返回 `{ok, diagnostics, binaryAvailable}`。每条诊断包含 `{line, col, message, severity}`。`binaryAvailable: false` 表示本机未安装 `actionlint`；可通过 Homebrew 或上游 release 安装。

---

## `coherence`

对工作区一致性层的**只读**视图 —— 显示哪些派生文档相对于其生成时所依据的上游已经过期。两个操作都不会修改文档、账本或任何编辑器状态；它们完全由 Rust 后端从各工作区的内核直接应答，因此即使没有编辑器窗口在前台也能工作。

另有两个只读操作暴露语义层：

- `claims` —— 当前的正典设定：`{claim, entryId, statement, maturity, invalidAt, visible}`。只有 `established` 状态的设定才会约束语义检查；`visible` 反映的是 default 上下文。
- `contexts` —— 上下文集合（隐式的 `default` 始终存在）：`{id, name, parent, enforcement, visibleClaims, errors}`。

一个受委托限制的写操作：

- `resolve` —— 以获得明确委托的智能体身份，解决一条活跃的过期边：`{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`。授权采用 fail-closed 策略：工作区所有者必须已向**你经过身份验证的桥接身份**授予一份涵盖该解决类型的、有效且未过期的委托（在应用内、从明细授予），并且该边必须处于活跃状态。每一次受委托的解决都会记入审计日志，并关联到该授予。设定与上下文的变更从不对外暴露 —— 正典始终由人类掌控。

所有操作都需要 `workspace_root`：要查询的工作区的绝对路径。可以从 `session.get_state`（已打开标签页的 `filePath`）或 workspace 工具获知。路径缺失、不是绝对路径或不是目录时，会以纯字符串错误拒绝。

### `status`

单个工作区的内核状态计数。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace_root` | string | 是 | 要查询的工作区的绝对路径 |

**返回：**

```json
{
  "initialized": true,
  "objects": 12,
  "open_items": 2,
  "quarantined": 0,
  "writer": "0198c0de-0000-7000-8000-000000000001"
}
```

| 字段 | 含义 |
|---|---|
| `initialized` | 当工作区尚无一致性账本（没有 `.vmark/` 目录）时为 `false`。此时除 `objects` 外的所有计数均为 0。 |
| `objects` | 被跟踪的对象（拥有一致性身份的文件）。 |
| `open_items` | 现存的非新鲜依赖边 —— 即当前明细的条数。 |
| `quarantined` | 上次读取时被隔离的格式错误账本行。 |
| `writer` | 本安装实例的 writer id（UUID）。 |

### `edges`

明细本身：上游已经变动的每一条现存依赖边。会先执行一次扫描对账，因此结果反映调用时磁盘上的文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `workspace_root` | string | 是 | 要查询的工作区的绝对路径 |

**返回**一个数组 —— 全部一致时为空：

```json
[
  {
    "txf": "0198c0de-0000-7000-8000-00000000000a",
    "input": 0,
    "upstream": "0198c0de-0000-7000-8000-00000000000b",
    "upstream_path": "characters/elena.md",
    "pinned": "rev-a1b2c3",
    "downstream": "0198c0de-0000-7000-8000-00000000000c",
    "downstream_path": "scenes/chapter-3.md",
    "downstream_rev": "rev-d4e5f6",
    "state": "version-stale"
  }
]
```

| 字段 | 含义 |
|---|---|
| `txf` / `input` | 标识这条边的转换条目与输入槽位（把它们传给应用内的裁决操作）。 |
| `upstream` / `upstream_path` | 下游所依赖的对象及其最后已知的路径。 |
| `pinned` | 下游生成时所依据的上游版本。 |
| `downstream` / `downstream_path` / `downstream_rev` | 派生对象、它的路径及其当前版本。 |
| `state` | `"version-stale"`、`"stale-valid"`、`"stale-contradicted"`、`"stale-unknown"`、`"waived"`、`"diverged"`、`"diverged-multi-head"` 或 `"unpinnable"`。 |

裁决一条边（接受新版 / 豁免）是在 VMark 的一致性明细视图中由人完成的操作 —— 有意不通过 MCP 暴露。

---

## 错误

会出现两类错误形态：

**领域错误** —— 把 `success` 置为 `false`，并在 `error` 中返回 JSON 编码的信封：

```json
{ "error": "STALE", "message": "...", "current_revision": "rev-..." }
```

**参数形态错误** —— 当必填参数缺失或类型不对时（例如 `document.write` 没带 `content` 字段），`error` 是描述问题的纯字符串。结构化信封专门留给领域级别的状况。

| 代码 | 呈现形式 | 含义 |
|---|---|---|
| `STALE` | 信封 | `expected_revision` 不匹配；请重新读取后再试 |
| `INVALID_PATCH` | 信封 | `workflow.apply_patch` 收到了格式错误的 `patches` 数组 |
| `INVALID_TAB` | 信封 | `tabId` 无法解析 |
| `INVALID_PATH` | 信封 | `workspace.open` 收到的 `filePath` 无法读取 |
| `NOT_WORKFLOW` | 信封 | 在非 yaml-workflow 标签页上调用了 `workflow.*` |
| `READ_ONLY` | 信封 | 试图对只读文档进行变更 |
| `INTERNAL` | 信封 | 处理器出现意外错误 |
| （纯字符串） | 字符串 | 必填参数缺失或类型错误 |
