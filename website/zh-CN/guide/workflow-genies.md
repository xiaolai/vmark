<script setup>
// Skip Vue template processing for the whole page so ${{ }} expressions
// in code spans and fenced YAML blocks don't get interpreted.
</script>

<div v-pre>

# 工作流精灵

VMark 精灵分为两种形式：

- **Markdown 精灵**（`.md`）——单次提示词模板，是最初的精灵格式。详见 [AI 精灵](/zh-CN/guide/ai-genies)。
- **工作流精灵**（`.yml` / `.yaml`）——多步骤流水线，将多个 Markdown 精灵串接起来，并具有显式的数据流。

两种格式存放在同一个全局精灵目录中，并出现在同一个选择器里（`Cmd+Y`）。一个工作流精灵在选择器中显示为普通的精灵条目；选中后会启动工作流运行器，而不是单次的 AI 调用。

## 何时使用哪一种

| 需求 | 格式 |
|------|------|
| 单次转换（润色、翻译、摘要） | Markdown |
| 大纲 → 草稿 → 润色的流水线 | 工作流 |
| 不同阶段使用不同 AI 模型 | 工作流 |
| 需要审批关卡的步骤 | 工作流 |
| 一个阶段的输出作为下一阶段的输入 | 工作流 |

如果一个提示词就够用，使用 Markdown 精灵。如果需要组合多个阶段、结构化数据流，或人工审批环节，则使用工作流。

## 文件格式

工作流精灵是一个 YAML 文件。顶层字段：

| 字段 | 是否必填 | 用途 |
|------|----------|------|
| `name` | 是 | 人类可读的标签。选择器使用**文件名**作为显示名称；如果未设置 `description:`，此字段会作为描述显示。 |
| `description` | 否 | 在选择器中显示的一行简介。 |
| `defaults` | 否 | 应用于每个步骤的默认模型、审批与限制。 |
| `env` | 否 | 可作为 `${VAR}` 或 `${{ env.NAME }}` 使用的环境变量。 |
| `steps` | 是 | 有序的步骤列表。 |

### 步骤结构

```yaml
- id: my-step
  uses: genie/<name>     # or action/<name>
  with:
    input: "text or expression"
  needs: prior-step      # optional; can also be a list
  approval: ask          # optional; "auto" (default) or "ask"
  model: claude-sonnet   # optional; overrides defaults
  limits:
    timeout: 120s        # default 300s
    max_tokens: 4096     # REST providers only
```

### 步骤类型

| `uses:` 前缀 | 行为 |
|--------------|------|
| `genie/<name>` | 加载匹配的 Markdown 精灵，使用步骤的 `with:` 映射填充其模板，并调用当前激活的 AI 服务商。Markdown 精灵的 `{{content}}` / `{{input}}` 占位符会自动取用 `with.input`。 |
| `action/read-file` | 读取相对于工作区的路径，输出为文件正文。 |
| `action/save-file` | 将 `with.input` 写入 `with.path`。 |
| `action/notify` | 记录 `with.message`。 |
| `action/copy` | 原样返回 `with.input`（便于链式串接）。 |

### 表达式

在任意 `with:` 值中：

| 语法 | 解析为 |
|------|--------|
| `${{ steps.ID.outputs.FIELD }}` | 前序步骤的某个特定输出字段。 |
| `${{ steps.ID.output }}` | 前序步骤 `outputs.text` 的语法糖。 |
| `${{ env.NAME }}` | 工作流 `env:` 中的某个值。 |
| `${VAR}` | 同上，旧式写法。 |
| `stepId.output`（整串） | `${{ steps.stepId.output }}` 的旧式别名。 |

未知的步骤或字段引用会在参数解析阶段就让该步骤失败，不会触发任何 AI 调用。

### 模板绑定

当一个 `genie/<name>` 步骤运行时，其 Markdown 精灵的提示词模板按以下规则填充：

- `{{input}}` → `with.input`
- `{{content}}` → 若存在则取 `with.content`，否则取 `with.input`（两者都缺失时致命错误）
- `{{context}}` → 若存在则取 `with.context`，否则为空字符串（永不致命）
- `{{any-other-key}}` → `with.<key>`（缺失时致命错误）

这意味着**现有的 Markdown 精灵在工作流中无需改动即可使用**——以 `with: { input: "..." }` 调用它们，`{{content}}` 占位符通过别名链自动取值。

### 审批关卡

当某个步骤设置了 `approval: ask`（或工作流 `defaults.approval: ask`）时，运行器会暂停，弹出一个对话框展示已解析的提示词预览与模型，并等待用户的裁决再调用服务商。`Esc` 表示拒绝。超时取步骤的 `limits.timeout` 与 10 分钟中的较小值。

## 示例

VMark 内置了一个示例工作流 `outline-and-polish.yml`，位于内置精灵目录中。可将其复制到你的用户精灵目录进行自定义：

```yaml
name: Outline and Polish
description: Generate an outline, then polish the output for clarity.

defaults:
  approval: auto

steps:
  - id: outline
    uses: genie/outline
    with:
      input: "Replace this seed with your topic."

  - id: polish
    uses: genie/polish
    needs: outline
    with:
      input: ${{ steps.outline.outputs.text }}
```

`genie/outline` 生成结构化大纲；随后的 `polish` 步骤将该输出改写得更清晰。两处 `genie/*` 引用解析到内置的 Markdown 精灵 `structure/outline.md` 与 `editing/polish.md`。

## 取消、超时与限制

- **取消**——点击工作流侧边栏中的“停止”。运行器会在一个 tick 内杀死任何在途的 CLI 服务商子进程，并丢弃在途的 REST 请求。
- **每步超时**——以 `tokio::time::timeout(step.limits.timeout)` 包裹。超时后，该步骤以“Timed out after Xs”失败，下游步骤被跳过。
- **输出上限**——单个步骤的输出上限为 5 MB。失控的服务商会触发取消并报“Provider output exceeded 5 MB cap”。

## 另请参阅

- [AI 精灵](/zh-CN/guide/ai-genies)——Markdown 精灵格式与编写。
- [工作流查看器](/zh-CN/guide/workflow-viewer)——这里使用的同一个 React Flow 侧边栏，最初为 GitHub Actions 工作流而设计。

</div>
