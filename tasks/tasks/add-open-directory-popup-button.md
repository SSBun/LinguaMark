# 在扩展 Popup 增加打开目录按钮

Status: Completed (2026-08-31 16:51)
Kind: Task

## Scope

- 包含：Popup 单一“打开阅读器”入口、可复用的独立空白 Viewer、Viewer 内 Markdown 文件选择与既有目录选择。
- 不包含：Popup 内直接弹出选择器、Markdown 编辑、非 Markdown 文件选择或多个独立 Viewer 实例。

## Target
- [x] T1: LinguaMark Popup 显示与现有视觉风格一致的“打开阅读器”按钮
- [x] T2: 点击后打开独立的空白 Markdown Viewer 标签页；已有该独立 Viewer 时聚焦复用而不重复创建
- [x] T3: 空白 Viewer 提供“打开 Markdown 文件”和“打开目录”，且只由用户点击触发对应的 Chrome 原生选择器
- [x] T4: 选择 Markdown 后按 Lightmind 渲染；选择目录后显示现有递归文件树、图片预览、禁用不支持类型及权限恢复能力
- [x] T5: 现有分析、显示开关、模型设置、直接 file:// Viewer 和顶部目录入口保持不变

## Plan

1. 让现有 Markdown 渲染器支持独立扩展 Viewer 与空状态。
2. 在独立 Viewer 中接入用户触发的 Markdown 文件和目录选择。
3. 在 Popup 增加单一入口，并复用已打开的独立 Viewer 标签页。
4. 验证空状态、文件与目录模式、手动分析和既有直接文件／网页行为。

## Decisions

- Popup 不直接承载文件或目录选择器；它只打开或聚焦唯一的 `viewer.html`。
- 独立 Viewer 顶部提供“打开文件”和“打开目录”，空状态不自动读取或上传任何内容。
- `viewer.html` 直接复用现有 `markdown.js`、`content.js`、Lightmind 与目录协议；Popup 通过查询完整 Viewer URL 聚焦已有标签页。
- 单文件选择只持有 FileSystemFileHandle，无法可靠定位父目录，因此相对文件与图片在单文件模式禁用并提示使用目录模式。

## Result

- T1: Popup Chromium 截图确认“打开阅读器”位于主分析按钮下方，使用现有玻璃拟态层级、44px 高度、键盘焦点和箭头样式。
- T2: 首次点击创建 chrome-extension://.../viewer.html；再次从 Popup 点击后 Viewer tab 数仍为 1，并聚焦已有标签页。
- T3: 空白 Viewer 仅显示“打开文件”和“打开目录”，目录开关实际 display:none；点击文件按钮调用 showOpenFilePicker，点击目录按钮打开现有授权窗口，均由真实用户点击触发。
- T4: 模拟原生文件句柄后 selected.md 以 Lightmind 渲染并生成标题目录；授权 Reader Library 后同一独立 Viewer 显示文件树并成功打开 library.md。
- T5: 独立 Viewer START_ANALYSIS 返回 2 个当前文档文本块；直接 file:// 样例仍渲染目录和 Mermaid，HTTP 烟雾页仍只返回唯一预期正文，现有设置与顶部入口未改变。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: npm run check、npm run build、npm audit --omit=dev、git diff --check、Context validate，以及 Popup 创建/复用、空状态、文件选择、目录通知、独立分析、直接 file:// 与 HTTP Chromium 烟雾检查均通过；未运行项目测试套件。
