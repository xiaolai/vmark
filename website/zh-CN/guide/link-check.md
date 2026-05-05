# 链接检查

VMark 会验证 markdown 中的本地链接和图片目标是否真实存在于磁盘上。它与 [Markdown 检查](/zh-CN/guide/lint) 一起在 `Cmd-Shift-L` 或 **工具 → 检查 Markdown** 时运行。

## 它检查什么

对文档中的每个本地链接和图片：

- `[text](./other.md)` —— 文件 `./other.md` 能解析且存在
- `![alt](./image.png)` —— 图片文件存在
- `[text](./other.md#section)` —— 文件存在（锚点检查由 [`linkFragments` 规则](/zh-CN/guide/lint#规则参考)处理）

当目标缺失时，链接文本会被标上红色波浪线，并在 lint 徽章 / F2 导航中出现一条记录。

## 它跳过什么

- **仅片段链接**（`#anchor`）—— 由 `linkFragments` 规则处理，针对当前文档的标题进行检查
- **外部 URL** —— `http://`、`https://`、`ftp://`、`mailto:`、`tel:`、`data:`、`file:`
- **未命名文档** —— 没有保存的文件路径，相对 URL 无法相对于任何目录解析

## 解析方式

链接检查相对于源文件目录解析路径：

| `/repo/docs/intro.md` 中的链接 | 解析为 |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/repo/docs/docs/intro.md`（按相对于文件所在目录处理） |

文件查找前会去除片段 —— `[a](./other.md#section)` 只检查 `./other.md`。

## 性能

- **异步** —— 与同步规则并行运行；结果就绪时合并进来
- **去重** —— 每个唯一的解析路径每次运行只检查一次，即使被多处链接也是如此
- **不按键触发** —— 每次按键都执行 fs.exists 会拖累性能；只在显式触发 lint 时运行
- **运行时错误容忍** —— 如果 `fs.exists` 抛出异常（权限被拒、能力作用域问题），结果是 `error`（跳过），而不是 `missing`。沉默优于错误。

## 诊断代码

| 代码 | 严重级别 | 触发条件 |
|---|---|---|
| **M001** | 错误 | 在解析后的本地路径上未找到图片文件 |
| **M002** | 错误 | 在解析后的本地路径上未找到链接的文件 |

## 另请参阅

- [Markdown 检查](/zh-CN/guide/lint) —— 完整规则参考
- [设置 → Markdown → Lint](/zh-CN/guide/settings#lint)
