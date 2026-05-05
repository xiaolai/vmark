# 智能 Tab 导航

VMark 的 Tab 和 Shift+Tab 键具有上下文感知能力——可帮助你高效地在格式化文本、括号和链接之间导航，无需使用方向键。

## 快速概览

| 上下文 | Tab 操作 | Shift+Tab 操作 |
|--------|----------|----------------|
| 在括号 `()` `[]` `{}` 内 | 跳过闭合括号 | 跳到开括号之前 |
| 在引号 `""` `''` 内 | 跳过闭合引号 | 跳到开引号之前 |
| 在中日韩括号 `「」` `『』` 内 | 跳过闭合括号 | 跳到开括号之前 |
| 在 **粗体**、*斜体*、`代码`、~~删除线~~内 | 跳到格式标记之后 | 跳到格式标记之前 |
| 在链接内 | 跳到链接之后 | 跳到链接之前 |
| 在表格单元格中 | 移动到下一个单元格 | 移动到上一个单元格 |
| 在列表项中 | 缩进该项 | 取消缩进该项 |

## 括号与引号跳出

当光标紧靠在闭合括号或引号之前时，按 Tab 可跳过它。当光标紧靠在开括号或引号之后时，按 Shift+Tab 可跳回到它之前。

### 支持的字符

**标准括号和引号：**
- 圆括号：`( )`
- 方括号：`[ ]`
- 花括号：`{ }`
- 双引号：`" "`
- 单引号：`' '`
- 反引号：`` ` ``

**中日韩括号：**
- 全角圆括号：`（ ）`
- 方头括号：`【 】`
- 角括号：`「 」`
- 白角括号：`『 』`
- 双书名号：`《 》`
- 书名号：`〈 〉`

**弯引号：**
- 双弯引号：`" "`
- 单弯引号：`' '`

### 工作原理

```text
function hello(world|)
                    ↑ cursor before )
```

按 **Tab**：

```text
function hello(world)|
                     ↑ cursor after )
```

嵌套括号同样有效——Tab 只跳过紧邻的闭合字符。

按 **Shift+Tab** 执行反向操作——如果光标紧靠在开括号之后：

```text
function hello(|world)
               ↑ cursor after (
```

按 **Shift+Tab**：

```text
function hello|(world)
              ↑ cursor before (
```

### 中日韩示例

```text
这是「测试|」文字
         ↑ cursor before 」
```

按 **Tab**：

```text
这是「测试」|文字
          ↑ cursor after 」
```

## 格式标记跳出（所见即所得模式）

在所见即所得模式中，Tab 和 Shift+Tab 可以跳出内联格式标记。

### 支持的格式

- **粗体** 文本
- *斜体*文本
- `内联代码`
- ~~删除线~~
- 链接

### 工作原理

当光标位于格式化文本内的任意位置时：

```text
This is **bold te|xt** here
                 ↑ cursor inside bold
```

按 **Tab**：

```text
This is **bold text**| here
                     ↑ cursor after bold
```

Shift+Tab 执行反向操作——跳到格式标记的开始处：

```text
This is **bold te|xt** here
                 ↑ cursor inside bold
```

按 **Shift+Tab**：

```text
This is |**bold text** here
        ↑ cursor before bold
```

### 链接跳出

Tab 和 Shift+Tab 也可以从链接中跳出：

```text
Check out [VMark|](https://vmark.app)
               ↑ cursor inside link text
```

按 **Tab**：

```text
Check out [VMark](https://vmark.app)| and...
                                    ↑ cursor after link
```

在链接内按 **Shift+Tab** 移动到开始处：

```text
Check out |[VMark](https://vmark.app) and...
          ↑ cursor before link
```

## 链接导航（源码模式）

在源码模式中，Tab 在 Markdown 链接语法内提供智能导航。

### 嵌套与转义括号

VMark 能正确处理复杂的链接语法：

```markdown
[text [with nested] brackets](url)     ✓ Works
[text \[escaped\] brackets](url)       ✓ Works
[link](https://example.com/page(1))    ✓ Works
```

Tab 导航能正确识别链接边界，即使存在嵌套或转义括号。

### 标准链接

```markdown
[link text|](url)
          ↑ cursor in text
```

按 **Tab** → 光标移动到 URL：

```markdown
[link text](|url)
            ↑ cursor in URL
```

再按 **Tab** → 光标退出链接：

```markdown
[link text](url)|
                ↑ cursor after link
```

### Wiki 链接

```markdown
[[page name|]]
           ↑ cursor in link
```

按 **Tab**：

```markdown
[[page name]]|
             ↑ cursor after link
```

## 源码模式：Markdown 字符跳出

在源码模式中，Tab 也可以跳过 Markdown 格式字符：

| 字符 | 用途 |
|------|------|
| `*` | 粗体/斜体 |
| `_` | 粗体/斜体 |
| `^` | 上标 |
| `~~` | 删除线（作为整体跳过） |
| `==` | 高亮（作为整体跳过） |

### 示例

```markdown
This is **bold|** text
              ↑ cursor before **
```

按 **Tab**：

```markdown
This is **bold**| text
                ↑ cursor after **
```

::: info
源码模式不支持 Shift+Tab 跳出 Markdown 字符——Shift+Tab 在源码模式中只执行取消缩进（删除前导空格）。
:::

## 源码模式：自动配对

在源码模式中，输入格式字符会自动插入对应的闭合字符：

| 字符 | 配对 | 行为 |
|------|------|------|
| `*` | `*\|*` 或 `**\|**` | 延迟触发——等待 150ms 以判断是单个还是双个 |
| `~` | `~\|~` 或 `~~\|~~` | 延迟触发 |
| `_` | `_\|_` 或 `__\|__` | 延迟触发 |
| `=` | `==\|==` | 始终配对为双个 |
| `` ` `` | `` `\|` `` | 单个反引号在延迟后配对 |
| ` ``` ` | 代码围栏 | 行首三个反引号创建围栏代码块 |

在围栏代码块内，自动配对 **禁用**——在代码块中输入 `*` 会插入字面量 `*`，不进行配对。

在配对之间按 Backspace 会同时删除两个字符：`*\|*` → Backspace → 空。

## 表格导航

当光标在表格内时：

| 操作 | 按键 |
|------|------|
| 下一个单元格 | Tab |
| 上一个单元格 | Shift + Tab |
| 添加行（在最后一个单元格时） | Tab |

在最后一行的最后一个单元格按 Tab 会自动添加新行。

## 列表缩进

当光标在列表项中时：

| 操作 | 按键 |
|------|------|
| 缩进项目 | Tab |
| 取消缩进项目 | Shift + Tab |

## 设置

Tab 跳出行为可在 **设置 → 编辑器** 中自定义：

| 设置 | 效果 |
|------|------|
| **自动配对括号** | 启用/禁用括号配对和 Tab 跳出 |
| **中日韩括号** | 包含中日韩括号对 |
| **弯引号** | 包含弯引号对（`""` `''`） |

::: tip
如果 Tab 跳出与你的工作流冲突，可以完全禁用自动配对括号。这样 Tab 就会正常插入空格（或在列表/表格中执行缩进）。
:::

## 对比：所见即所得模式与源码模式

| 功能 | Tab（所见即所得） | Shift+Tab（所见即所得） | Tab（源码） | Shift+Tab（源码） |
|------|------------------|------------------------|-------------|-------------------|
| 括号跳出 | ✓ | ✓ | ✓ | — |
| 中日韩括号跳出 | ✓ | ✓ | ✓ | — |
| 弯引号跳出 | ✓ | ✓ | ✓ | — |
| 格式标记跳出（粗体等） | ✓ | ✓ | N/A | N/A |
| 链接跳出 | ✓ | ✓ | ✓（字段导航） | — |
| Markdown 字符跳出（`*`、`_`、`~~`、`==`） | N/A | N/A | ✓ | — |
| Markdown 自动配对（`*`、`~`、`_`、`=`） | N/A | N/A | ✓（延迟触发） | N/A |
| 表格导航 | 下一个单元格 | 上一个单元格 | N/A | N/A |
| 列表缩进 | 缩进 | 取消缩进 | 缩进 | 取消缩进 |
| 多光标支持 | ✓ | ✓ | ✓ | — |
| 在代码块内跳过 | ✓ | ✓ | ✓ | N/A |

## 多光标支持

Tab 跳出支持多光标——每个光标独立处理。

### 工作原理

当你有多个光标并按 Tab 或 Shift+Tab 时：
- **Tab**：格式内的光标跳到末尾；闭合括号前的光标跳过括号
- **Shift+Tab**：格式内的光标跳到开头；开括号后的光标跳到括号前
- 普通文本中的光标保持不动

### 示例

```text
**bold|** and [link|](url) and plain|
     ^1          ^2            ^3
```

按 **Tab**：

```text
**bold**| and [link](url)| and plain|
        ^1               ^2         ^3
```

每个光标根据其上下文独立跳出。

::: tip
这对于批量编辑特别强大——用 `Mod + D` 选中多个出现位置，然后用 Tab 同时从所有位置跳出。
:::

## 优先级与代码块行为

### 跳出优先级

当多个跳出目标重叠时，Tab 按 **由内而外** 的顺序处理：

```text
**bold text(|)** here
               ↑ Tab jumps ) first (bracket is innermost)
```

再按 **Tab**：

```text
**bold text()**| here
               ↑ Tab escapes bold mark
```

这意味着括号跳出始终优先于格式标记跳出——你可以依赖 Tab 先退出括号，再退出格式。

### 代码块保护

代码块内的括号跳出 **禁用**——包括 `code_block` 节点和内联代码 span。这可以防止 Tab 跳过代码中的括号（括号在代码中是字面语法）：

```text
`array[index|]`
              ↑ Tab does NOT jump ] in inline code — inserts spaces instead
```

在所见即所得模式和源码模式中，代码块内的自动配对插入也被禁用。

## 使用技巧

1. **建立肌肉记忆**——一旦习惯了 Tab 跳出，你会发现无需使用方向键就能快速导航。

2. **与自动配对协作**——当你输入 `(` 时，VMark 会自动插入 `)`。在括号内输入后，只需按 Tab 跳出。

3. **嵌套结构**——Tab 每次只跳出一层。对于 `((nested))`，需要按两次 Tab 才能完全退出。

4. **Shift + Tab**——Tab 的镜像操作。从格式标记、链接和开括号向后跳出。在表格中移动到上一个单元格，在列表中取消缩进。

5. **多光标**——Tab 跳出同时对所有光标生效，让批量编辑更加高效。
