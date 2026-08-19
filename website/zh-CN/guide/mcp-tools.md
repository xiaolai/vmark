# MCP 工具参考

VMark 向 AI 助手暴露 **九个复合 MCP 工具**：`session`、`workspace`、`document`、`workflow`、`selection`、`browser`、`browser_read`、`coherence` 和 `coherence_resolve`。它们合计涵盖编辑器读写主轴、文件与窗口生命周期、CST 安全的工作流编辑、针对选区的精准编辑、受限的浏览器导航，以及对工作区一致性层的视图。

九个工具中有三个 —— `session`、`browser_read` 和 `coherence` —— 声明了 `readOnlyHint: true`，因此 MCP 客户端可以自动批准它们。这也正是 `browser`/`browser_read` 与 `coherence`/`coherence_resolve` 之所以要拆成独立工具的原因：注解是**按工具**而非按操作生效的，所以一个把 ARIA 快照和 `execute_js` 捆在一起的工具，不得不对外声明 `execute_js` 的危险性。按“这个操作会不会修改任何东西？”来拆分，能让两半各自如实陈述，也让接口中真正具有破坏性的操作在工具列表里保持醒目。

之前的 12 工具 / 76 操作接口已被精简，因为文档内的格式化工具（粗体、标题、表格等）与 AI 智能体通过 Markdown 往返已经能轻松完成的工作重复。之所以保留 `selection`（依据精简方案的 ADR-7），是因为整篇文档往返在大文件上并不划算 —— 每次编辑都要在输入 token 上付出整篇文档的代价、在输出 token 上再付出整篇文档的代价（约为输入价格的 5 倍），还要承受更长的写入窗口，从而扩大过期版本的重试循环。完整的设计取舍参见 [MCP 精简方案](https://github.com/xiaolai/vmark/blob/main/dev-docs/plans/20260504-mcp-pruning.md)。

::: tip 推荐工作流
1. 调用一次 `session.get_state`，即可看到所有打开的窗口、标签页，以及每个标签页的 `{filePath, dirty, revision, kind}`。
2. 对于小幅 Markdown 改动或整体重写：`document.read` → 推理 → `document.write`（传入 `expected_revision` 以保证并发安全）。
3. 当用户已经选中要修改的区域、需要在大型 Markdown 文件上做定向编辑时：`selection.get` → 推理 → `selection.set`（把输入和输出的 token 成本都收缩到选区大小）。
4. 对于 GitHub Actions YAML（`kind: "yaml-workflow"`）：用 `workflow.apply_patch` 进行 CST 安全的编辑，保留注释和锚点；用 `workflow.validate` 获取 actionlint 诊断。
5. 文件操作（打开、保存、关闭、切换标签页）归 `workspace` 管。
:::

::: tip Mermaid 图表
通过 MCP 使用 AI 生成 Mermaid 时，建议安装 [mermaid-validator MCP 服务器](/guide/mermaid#mermaid-validator-mcp-server-syntax-checking) —— 它使用与 VMark 同款的 Mermaid v11 解析器，在图表进入文档前先捕获语法错误。
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
      "activeWorkspaceInstanceId": "wsi-a1b2c3",
      "tabs": [
        {
          "id": "tab-1",
          "filePath": "/path/to/notes.md",
          "title": "notes",
          "dirty": false,
          "revision": "rev-x7Q3aB1F",
          "kind": "markdown",
          "active": true,
          "visible": true
        },
        {
          "id": "tab-2",
          "filePath": "/repo/.github/workflows/ci.yml",
          "title": "ci",
          "dirty": true,
          "revision": "rev-x7Q3aB1F",
          "kind": "yaml-workflow",
          "active": false,
          "visible": false
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

#### 判断真正显示在屏幕上的是什么

一个标签页可能存在、可被寻址，却仍然没有显示出来。三个字段能说明这一点：

| 字段 | 含义 |
|---|---|
| `tab.active` | 该标签页是其所属窗口的当前标签页。 |
| `tab.visible` | 该标签页此刻正在渲染。当标签页属于窗口当前未显示的某个工作区实例时，它为 `false`。 |
| `window.activeWorkspaceInstanceId` | 窗口正在显示的工作区实例；当工作区侧栏关闭时为 `null`（此时每个标签页都可见）。 |

`window.focused` 是**用户**正在注视的那个窗口，取自操作系统。它并不是“应答本次请求的那个窗口” —— VMark 会把请求路由到拥有相关工作区的那个窗口，在多窗口会话中，那往往是另一个窗口。

把这些字段当作确认步骤：在 `workspace.switch_tab` 之后，再跟一次 `get_state` 就能告诉你标签页是否真的呈现在用户面前。`switch_tab` 自身在应答前会重新读取各个 store，因此当激活没有落实时，它会报告 `activated: false`，而不是把请求原样回显。

`kind` 判别字段告诉你应该对该标签页使用 `document.write`（对应 markdown）还是 `workflow.apply_patch`（对应 yaml-workflow）。

---

## `workspace`

文件与窗口生命周期。不涉及文档内部内容。

> **路径范围。** 文件操作（`open`、`save`、`save_as`）被限定在已打开的工作区根目录，以及已经打开的文档所在目录之内。对该范围之外路径的请求会以 `INVALID_PATH` 拒绝。当既没有工作区、也没有打开的文档时，就不存在任何范围，因此文件操作会被拒绝。这样能让自动化客户端始终在你已经打开的范围内活动。

### `new`

新建一个未命名标签页。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `kind` | string | 否 | `"markdown"`（默认）或 `"yaml-workflow"` |
| `windowLabel` | string | 否 | 目标窗口；默认是当前聚焦窗口 |

返回 `{tabId}`。

### `open`

从磁盘打开一个**文件**到**后台**标签页 —— 用户当前可见的标签页和工作区都不会改变。把返回的 `tabId` 接续到 `document` / `selection` 调用中；只有当需要让用户*看到*该标签页时才用 `switch_tab`。

| 参数 | 类型 | 必填 |
|------|------|------|
| `filePath` | string | 是 |
| `windowLabel` | string | 否 |

返回 `{tabId, workspaceInstanceId, activationChanged, workspaceSwitched}`。

### `open_workspace`

把一个**文件夹**作为活动工作区打开。与 `open`（在已获授权的目录树中打开单个文件）不同，此操作会授予助手访问一整棵全新文件树的权限，因此它**受一次性用户批准的门控**，且不在上文的路径范围之内。

| 参数 | 类型 | 必填 |
|------|------|------|
| `folderPath` | string | 是 |

与 `new` 和 `open` 不同，这里**不**接受 `windowLabel`。文件夹总是在请求到达的那个窗口中打开。这是有意为之：批准对话框和打开操作必须落在同一个窗口，而客户端提供的标签可能会把提示弹在一个窗口面前、却去改动另一个窗口 —— 批准的是一回事，得到的却是另一回事。多窗口定向需要一套目前尚不存在的请求路由机制。

**批准流程。** 首次调用返回 `{needsApproval: true}`，并弹出一个命名了该文件夹*规范*路径（符号链接已解析）的同意对话框。助手应当询问用户，然后**重试同一次调用**；一旦用户批准，重试就会打开该文件夹。被拒绝的请求会持续失败，直到重新获得批准。没有“记住”选项 —— 每次打开都要单独批准。

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

保存到标签页自身当前文件以外的路径，会被视为一次全新的写入。当**自动批准编辑**（设置 → 集成）关闭时（默认如此），这类请求会以 `APPROVAL_REQUIRED` 拒绝，并弹出一条提示告诉你什么被拦下了。保存回标签页自身的路径则始终被允许。

### `close`

关闭一个标签页。如果没有 `force`，拒绝丢弃未保存的改动。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 是 |
| `force` | boolean | 否 |

成功时返回 `{closed: true}`；若标签页处于脏状态而未提供 `force`，则返回 `{closed: false, reason: "DIRTY"}`。

### `switch_tab`

激活一个标签页并使其**可见**。在启用了 [工作区侧栏](/guide/workspace-rail) 的情况下，这可能会切换用户当前活动的工作区上下文 —— 发生切换时响应会报告 `workspaceSwitched: true`，因此助手应当据此告知用户。

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 是 |

返回 `{activated, workspaceSwitched, workspaceInstanceId, activeTabId}`。

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

## `selection`

读取或替换用户当前的编辑器选区。当用户已经把要修改的区域高亮出来时，用它来代替 `document.read`/`document.write` —— `selection.get` 只返回选中的那一小段，`selection.set` 也只重写该范围，因此 token 成本随编辑量而非整篇文档规模伸缩。

::: warning 选区属于视图状态 —— 仅限聚焦的标签页
选区只存在于当前正在渲染的编辑器中。如果提供了 `tabId`，它必须与聚焦的标签页一致；不匹配则返回 `INVALID_TAB`。如果聚焦的标签页没有活动编辑器（例如只读查看器），响应为 `NO_EDITOR`。
:::

### `get`

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否 |

返回：

| 字段 | 类型 | 说明 |
|---|---|---|
| `text` | string | 选中片段的 Markdown 序列化结果（所见即所得模式），或原始选中文本（源码模式）。选区折叠时为空字符串。 |
| `isEmpty` | boolean | 当选区折叠（仅有光标）时为 `true`。 |
| `range` | `{from, to}` | 所见即所得模式下为 ProseMirror 位置；源码模式下为字符偏移量。 |
| `mode` | `"wysiwyg"` \| `"source"` | 用于消解 `range` 所处位置空间的歧义。 |
| `kind` | `"markdown"` \| `"yaml-workflow"` | 文档种类判别字段。 |
| `tabId` | string | 回显以供确认。 |
| `revision` | string | 传回 `set` 以实现乐观并发控制。 |

### `set`

| 参数 | 类型 | 必填 |
|------|------|------|
| `tabId` | string | 否 |
| `content` | string | 是 |
| `expected_revision` | string | 否（推荐） |

替换编辑器报告的当前选区中的任何内容。**在所见即所得模式下**，纯行内文本会作为字面文本节点插入，因此前导 / 尾随空白能精确往返；带有 markdown 标记的内容（`**bold**`、`*italic*`、`` `code` ``、围栏代码、引用块、列表等）会被解析为 markdown 并作为对应的节点插入。**在源码模式下**，`content` 始终作为原始文本拼接进去 —— 源码界面本身就是 markdown 字节。`content` 为空则删除选区。当选区折叠时，`content` 会插入到光标处。

成功时返回 `{revision, replaced_chars}`。`replaced_chars` 是调用前被选中文本的长度 —— 便于 AI 确认它编辑的正是自己预期的内容。

`STALE` 返回 `{error: "STALE", message, current_revision}`，与 `document.write` 完全一致。文档级 revision 会捕捉 `get` 与 `set` 之间发生的按键。纯粹的光标移动（不含按键）不由服务器仲裁 —— 如果用户在 `get` 与 `set` 之间移动了光标，编辑就会落在新位置上。

---

## `browser`

内嵌浏览器接口中**会产生变更**的那一半 —— 一切会改变页面、标签页或已存登录信息的操作。请先用 [`browser_read`](#browser-read) 读取页面：这里的每一种定位方式都指向某次读取所返回的内容。

浏览器工具遵循**设置 → 高级 → macOS → 内嵌浏览器**开关，该开关在 macOS 上**默认开启** —— 因此除非你关掉它，否则已连接的 AI 客户端就能使用这些工具。关闭期间，每个操作都会以 `BROWSER_DISABLED` 失败。返回给 MCP 的 URL 会经过与应用浏览器会话状态相同的边界进行脱敏。

注解为 `readOnlyHint: false, destructiveHint: true` —— 这是如实标注而非仅出于保守，因为这里的每个操作都会改动某些东西。

### `act`

参数：`tabId?`、`operation: "click" | "type" | "scroll" | "key"`，以及各操作对应的目标：

- **click / type** —— 一个目标，可以是 `ref`（来自先前一次读取）**或** `role` + `name`，输入时还有 `text?`。`ref` 精确且与顺序无关，但仅对**已获授权**的操作有效；如果该操作可能需要批准，请用 `role` + `name`，好让提示向用户展示一个可读的元素。
- **scroll** —— `ref`（将其滚动到可见区域）**或** `dy`（垂直方向的像素增量）。
- **key** —— `key`（例如 `"Enter"`、`"Escape"`、`"Tab"`）、可选的用于定位的 `ref`，以及可选的 `modifiers: {ctrl, shift, alt, meta}`。

`scroll` 和 `key` 属于 act 类（受批准门控），派发的是**合成的** DOM 事件，因此以 `event.isTrusted` 作门控的站点可能会忽略它们。产生变更的操作需要按来源（origin）授权；AI 自行选择的文件上传从不被允许。

**一次点击在报告成功之前会先验证其效果。** 目标会被滚动到可见区域，且必须可见地渲染出来（会检查计算样式和折叠的祖先元素，因此一个位于已折叠手风琴步骤内的重复按钮会被跳过，而不会被点击），并且会对点击点做命中测试 —— 被遮罩覆盖的目标会被拒绝，并指名遮挡者（`covered by div.cmp-overlay`），而不是穿透点击。role + name 的结果会带上 `matchedTotal` / `matchedVisible` 计数，使歧义可见，而且每次 act 响应都包含标签页当前的 `url` 和 `generation`。`type` 能处理文本字段、`<select>` 控件（传入选项的 label 或 value；不存在的选项会以 `no-such-option` 拒绝）以及 `contenteditable` 区域。

### `workflow_run` / `workflow_cancel`

`workflow_run` 在一个 AI 拥有的标签页上运行你以 `source` 文本提供的工作流。参数：`tabId?`、`source`（工作流文本 —— 一套小巧的、以行为单位的语法；在当前构建中由你或 AI 编写，它同时也是应用内录制器将来上线后会产出的格式）、`inputs?`（一个 `{name: value}` 映射，会代入到 `{name}` 引用中）、`allowRepeat?`。它会**立即**返回 `{runId, steps}` —— 运行本身是**异步**执行的，因为一次多步运行可能比单次请求活得更久。轮询 [`browser_read`](#browser-read) 的 `workflow_status` 以获取进度。

确定性步骤 —— 该语法中的 `click` / `type` / `navigate`，以及 `extract` —— 在 VMark 内部运行，并**逐个受批准门控**，与手动发出的 `act` 完全一样：运行会为每一步单独取得授权，因此工作流并不是绕开批准提示的途径。`goal`、`confirm`、`api` 以及任何自由文本步骤会**暂停**运行，交给 AI 手动处理。除非设置了 `allowRepeat`，否则重新运行会**跳过本会话中已经成功的写入步骤**（依据已完成写入的账本）—— 这样在暂停后重新运行不会重复提交。

`workflow_cancel {tabId?, runId}` 停止一次运行。它**从不受批准门控** —— 停止总是被允许的 —— 并会撤回该运行待处理的提示，把标签页交还给你。此外，一旦你接管浏览器（与页面或其外壳的任何交互都会重新夺回控制权），运行也会立刻停止。

运行是有上界的（≤ 25 步、≤ 120 秒、source ≤ 64 KiB），且每个标签页同一时间只能有一个。

### `open`

参数：`url`，以及可选的 `timeoutMs`（1–12,000 毫秒）。使用当前的沙盒（Sandbox）或共享（Shared）态势创建一个 AI 拥有的标签页，并在加载完成后返回它的 `tabId`、`navigationId`、URL、标题和 generation。

### `navigate`

参数：`tabId?`、`url`，以及可选的 `timeoutMs`。导航一个 AI 拥有的标签页，并返回导航票据（ticket）的结果。即便超时也仍会返回票据，以便后续的 `wait` 能取回最终结果。

**门槛检测。** 当着陆页读起来像一道**登录墙**、**同意插页**、**人机验证挑战**或**限流**时，一次加载完成的 `open` / `navigate` / `wait` 结果可能会带上 `gate: {kind, hint}` —— 好让 AI 在读取结果的那一刻就得知，它看到的并不是自己请求的内容。检测以精确为先（一个已渲染的挑战组件，或在内容稀疏的页面上至少两个相互独立的信号 —— 单个 `$429` 价格、一句 "Protected by Cloudflare" 页脚，或一篇*关于* CAPTCHA 的文章，都不会被判定为门槛），且纯属提示性质：它只改变告知 AI 的内容，绝不改变被授权的范围，而且每条提示都指向让你介入，而不是绕过门槛。

### `style`

参数：`tabId?`、一个目标（`ref` **或** `selector`），以及 `set: {prop: value}`、`addClasses`、`removeClasses` 或 `injectCss` 之一。可用于消除阻挡的遮罩、高亮某个目标等。**属于 act 类**（受批准门控，操作为 `style`）。运行于隔离的内容世界（isolated content world）。

### `execute_js`

参数：`tabId?`、`script`（必须 `return` 一个可 JSON 序列化的值）。这是当结构化动词无法表达时的应急出口。它运行于**隔离的内容世界** —— 它共享 DOM（因此 `querySelector`、`element.style` 都能用），但**无法**看到页面自身的 JS 堆 / 全局变量。它**仅按次批准**（绝无长期授权，由 Rust 驱动强制执行），批准时会展示脚本，其返回值会被标记为**不可信**，绝不会自动喂给后续的 `act`。请优先考虑 `query`/`style`。

### `session_save` / `session_load`

参数：`tabId?`、`handle`（`[A-Za-z0-9._-]`，1–128 个字符）。`session_save` 会把标签页的会话快照存入一个以 `handle` 命名的 **OS-keychain** 条目，并返回一份不含任何值的摘要（仅计数）；`session_load` 将其恢复，并返回 `{loaded: true, handle}` —— 一个确认加上 AI 提供的 handle，绝不含任何值。`session_load` 只对与会话保存时**同源**的页面生效。这是**按引用**传递凭据（ADR-A7）：AI 指名一份已保存的会话，而绝不会收到 Cookie / 令牌的值，这些值也从不被记录。两者都属于 `session` 权限 —— **绝无长期授权**（按次批准），且对某个 handle 的批准不能挪用到另一个 handle 上。*目前这只覆盖 `localStorage`；Cookie 捕获是一项有待实机测试的后续工作。*

### `console_clear`

参数：`tabId?`。返回 `{entries: [{level, text}], url}`，与 [`browser_read`](#browser-read) 的 `console` 完全相同，**并会清空缓冲区**，使下一次读取只看到新的输出。它之所以归在这里而不是与其他 console 读取放在一起，是因为清空会在页面中执行 `element.textContent = "[]"` —— 这是一次 DOM 写入。

共享态势下，除非已有匹配的 `navigate` 授权，否则每遇到一个新来源都会请求目标批准。由人类创建的标签页，在 AI 读取 / 操作之前需要一次临时的附着（attachment）批准。沙盒标签页使用一个独立的、非持久化的 AI Cookie 存储。

---

## `browser_read`

**只读**的那一半：观察标签页而不改变它。注解为 `readOnlyHint: true`，因此 MCP 客户端可以自动批准它 —— 这正是拆分的意义所在。这些操作过去都归在 `browser` 上，而在那里，单个工具级别的注解还得同时描述 `execute_js`，于是拍一张 ARIA 快照都要花掉一次人工批准。

`openWorldHint` 仍为 `true`：只读描述的是这个工具*改变*什么，而不是返回的字节是否可信。返回的一切都由页面控制，且**不可信** —— 绝不要把某个结果直接回喂作 `browser` 的 act 目标。

### `read`

返回聚焦的浏览器标签页（或由 `tabId` 指名的标签页）的 `{url, snapshot}`。`snapshot` 是一个以 ARIA 为导向的 `{role, name, ref}` 列表 —— 每个 `ref`（例如 `"e5"`）都是该元素的稳定句柄，在当前视图的生命周期内有效。

### `screenshot`

参数：`tabId?`。返回标签页当前渲染结果的一个**图像内容块**（base64 JPEG，受质量上限约束），外加一行指明页面的文本 —— 这是一条通往布局与渲染状态的视觉通道，而这些是 ARIA 快照无法描述的。它由原生方式捕获（`takeSnapshot`），不读取任何页面 DOM 或 JavaScript。属于读取类：授权方式与 `read` 完全一致（在 AI 拥有的标签页上允许；人类标签页需要一次附着，捕获时消耗）。

### `query`

参数：`tabId?`、`selector`（CSS），以及可选的 `fields: {attributes, box, styles:[...]}`。返回 `{count, elements: [{ref, tag, text, …}]}` —— 这是 ARIA 快照无法指名的结构化 DOM 数据（表格、计算值）。**属于读取类。** 运行于隔离的内容世界。

### `extract`

参数：`tabId?`。返回 `{title, byline, url, markdown, textLength, truncated}` —— 即以**阅读器模式 Markdown** 呈现的页面，面向 AI 想*阅读*而非操作的页面。一次有上限的捕获会导出页面的 HTML；抽取本身在 VMark 内进行，绝不在页面中进行：为该来源注册的**站点插件**拥有优先权（内置的 Wikipedia 插件会按名称剥除 wiki 外壳 —— 信息框、导航框、提示条、编辑链接），而一个通用的、基于密度启发式的阅读器则是所有其他站点的兜底。`truncated: true` 表示页面超出了捕获上限，尾部未被读取。**属于读取类。** 返回的一切都源自页面且不可信。

### `workflow_status`

参数：`tabId?`、`runId`（来自 `workflow_run`）。返回 `{status, completedSteps, stepCount, pausedAt?, reasonCode?, reason?, stepResults}`，其中 `status` 是 `running` / `paused` / `completed` / `failed` / `cancelled` 之一。`paused` 状态会在 `pausedAt` 中指明需要你介入的那一步。**属于读取类** —— 可放心轮询。

### `console`

参数：`tabId?`。返回 `{entries: [{level, text}], url}` —— 即页面被捕获的 `console.*` 输出，外加**未捕获的错误和未处理的 Promise 拒绝**（记录为 `level: "error"` 条目，前缀分别为 `Uncaught` / `Unhandled rejection:` —— 这类信号仅靠给 `console.*` 打补丁是永远看不到的）。仅限沙盒标签页。捕获的原理是一个页面世界（page-world）的垫片写入一个隐藏的 DOM 缓冲区，驱动再从隔离世界读取它 —— 因此**不会**有任何消息通道被打通回 VMark（无桥接保证得以维持）。输出由页面控制且**不可信** —— 请把它当作一次 `read` 来对待，绝不要用作 `act` 目标。

该缓冲区是一个有界的环形缓冲，因此连续两次读取会有重叠。若想边读边清空，请使用 [`browser`](#browser) 的 `console_clear` —— 清空会把 `[]` 写入页面的缓冲元素，这是一次 DOM 写入，因此不能置于 `readOnlyHint: true` 之下。

### `wait`

参数：`tabId?`、可选的 `navigationId`，以及可选的 `timeoutMs`。它从不发起导航。它会返回一个已缓冲的加载 / 失败结果、`NAVIGATION_SUPERSEDED`，或在票据未能在上界内完成时返回 `TIMEOUT`。

### `wait_for`

参数：`tabId?`、`ref`（来自一次读取）/ `role`（可加可选的 `name`）/ `text`（可见文本的子串）/ `urlContains`（标签页 URL 必须包含的子串 —— 用于确认由点击触发的导航已经着陆，直接依据标签页状态应答，无需页面往返）中的恰好一个，以及可选的 `timeoutMs`（1–12,000 毫秒）。它会轮询，直到条件成立或超时耗尽，然后返回 `{matched: true|false}`（对于 ref/role 条件，还会附上匹配元素的 `ref`）—— 这样你就能区分“找到了”和“超时了”。属于读取类。用它让流程变得确定：执行操作、`wait_for` 结果、再读取。

---

## `coherence`

对工作区一致性层的**只读**视图 —— 显示哪些派生文档相对于其生成时所依据的上游已经过期。没有任何操作会修改文档或编辑器状态。`status` 是只读的；`edges` 会先做一次对账，并可能向工作区账本追加溯源记录，但绝不改变文档内容。它们全部完全由 Rust 后端从各工作区的内核直接应答，因此即使没有编辑器窗口在前台也能工作。

另有两个只读操作暴露语义层：

- `claims` —— 当前的正典设定：`{claim, entryId, statement, maturity, invalidAt, visible}`。只有 `established` 状态的设定才会约束语义检查；`visible` 反映的是 default 上下文。
- `contexts` —— 上下文集合（隐式的 `default` 始终存在）：`{id, name, parent, enforcement, visibleClaims, errors}`。

注解为 `readOnlyHint: true`。唯一会产生变更的操作 `resolve` 归属于它自己的工具 —— 参见 [`coherence_resolve`](#coherence-resolve) —— 正是这一点让本工具得以自动批准。设定与上下文的变更从不对外暴露：正典始终由人类掌控。

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

裁决一条边（接受新版 / 豁免）通常是在 VMark 的明细视图中由人完成的操作。AI 只能通过 [`coherence_resolve`](#coherence-resolve) 来做，且仅当工作区所有者已明确将该权限委托给它时才行。

---

## `coherence_resolve`

一致性层上**唯一会产生变更的操作**，独立成一个工具，好让 [`coherence`](#coherence) 得以保持自动批准 —— 也让某个不可撤销的操作在工具列表里醒目呈现，而不是作为五个枚举值之一被埋没。注解为 `readOnlyHint: false, destructiveHint: true`。

### `resolve`

参数：`{workspace_root, txf, input, resolution: "accept-newer" | "waive", reason? (required for waive)}`。`txf` 和 `input` 来自 `coherence` → `edges` 的某一行。

以获得明确委托的智能体身份，裁决一条活跃的过期边。授权采用 **fail-closed** 策略：工作区所有者必须已向**你经过身份验证的桥接身份**授予一份涵盖该裁决类型的、有效且未过期的委托（在应用内、从一致性明细授予），并且该边必须仍然活跃。每一次受委托的裁决都会针对该授予记入审计日志，且该条目无法撤销。

被拒绝意味着授予缺失或已过期 —— 请让用户去授予，而不是重试。把它从 `coherence` 中拆出来并未改变任何安全性质：授权一直以经过身份验证的桥接主体为准，而从不取决于客户端所声称的任何内容。

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
| `INVALID_PATH` | 信封 | `filePath` 无法读取，或位于已打开的工作区 / 文档范围之外 |
| `APPROVAL_REQUIRED` | 信封 | 在**自动批准编辑**关闭时用 `save_as` 保存到新位置 |
| `NOT_WORKFLOW` | 信封 | 在非 yaml-workflow 标签页上调用了 `workflow.*` |
| `READ_ONLY` | 信封 | 试图对只读文档进行变更 |
| `NO_EDITOR` | 信封 | 调用了 `selection.*`，但聚焦的标签页没有活动编辑器 |
| `INTERNAL` | 信封 | 处理器出现意外错误 |
| （纯字符串） | 字符串 | 必填参数缺失或类型错误 |
