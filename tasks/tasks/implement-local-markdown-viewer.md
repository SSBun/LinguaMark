# 实现本地 Markdown 阅读器

Status: Completed (2026-08-31 13:51)
Kind: Task

## Scope

- 包含：已确认设计中的本地 `.md` 原页渲染、Lightmind 阅读样式、扩展 Markdown 特性、安全边界、相对资源和手动 LinguaMark 分析衔接。
- 不包含：Typora 编辑器能力、自动模型分析或非 Markdown 本地文件处理。

## Target
- [x] T1: 开启 Chrome 本地文件访问后，直接打开 file:///.../*.md 会在原标签页自动渲染且 URL 保持不变；权限未开启时提供明确指引
- [x] T2: Viewer 复现当前 Lightmind 的阅读样式，并覆盖基础 Markdown、任务列表、Alerts、脚注、目录、YAML、代码高亮、公式及当前主题涉及的 Mermaid 图表
- [x] T3: 相对图片、相对文档链接与标题锚点按当前 Markdown 文件位置正确解析
- [x] T4: 打开文件只进行本地渲染且不触发模型请求；用户手动启动后可沿用现有 LinguaMark 分析与标记流程
- [x] T5: 原始 HTML/CSS 的视觉内容得到保留，但脚本、事件处理器和可执行 URL 不运行，iframe 受到隔离
- [x] T6: 整体解析失败时保留原始 Markdown，单个公式或图表失败时只降级对应内容
- [x] T7: 现有 HTTP/HTTPS 网页分析与显示行为保持不变
- [x] T8: 用户当前 Chrome 直接打开本地 `.md` 时实际进入 Lightmind Viewer，而不是停留在 Chrome 原始文本视图；失败原因得到修复并有可复现验证

## Plan

1. 在用户所用 Google Chrome 稳定版复现截图中的原生 Markdown 页面，并检查实际 DOM 与扩展注入状态。
2. 定位并修复原生 Markdown Viewer 与 LinguaMark 渲染链路的兼容点。
3. 在稳定版 Chrome 重跑原始失败路径，并确认既有安全、图表、手动分析与 HTTP 行为不回归。

## Decisions

- 实现遵循同目录已完成的 [设计本地 Markdown 阅读器能力](design-local-markdown-viewer.md)。
- 本地 `.md` 使用独立 `markdown.js` 在既有 `content.js` 前同步建立 `article#write`；KaTeX、Mermaid、ZenUML 和代码高亮均由扩展本地打包。
- Lightmind 主题按当前本机主题快照随扩展发布；KaTeX 字体通过仅向 `file://` 开放的扩展资源加载。
- 不可信 HTML 在净化后再次克隆，以去除隔离世界中残留的内联处理器；原始 CSS 通过 CSSOM 解析并限制在 `#write` 作用域。
- 当前 Chrome Default profile 同时安装了 `docu.md Markdown Viewer`（扩展 ID `jekhhoflgcfoikceikgeenibinpojaoi`）；它从 `document_start` 匹配全部 `file://` 页面，并在 LinguaMark 标记 ready 后覆盖正文。双扩展临时 profile 已复现截图中的 `#page-shell`，关闭 docu.md 后 `article#write` 恢复。

## Result

- T1: 构建后的 Manifest 已在真实 Chromium 中加载；开启文件访问并直接打开 file:// 测试文档后原 URL 保持不变且 Viewer 标记为 ready，Popup 含权限检查与开启指引。
- T2: Lightmind 快照在 1280px Chromium 截图中完成视觉检查；任务列表、Alert、脚注、目录、YAML、代码、KaTeX 均渲染，14 类主题涉及的 Mermaid/ZenUML 图表全部成功。
- T3: 浏览器烟雾检查确认相对图标 naturalWidth 大于 0，相对 README 链接解析为同一工作区 file:// URL，标题目录锚点已生成。
- T4: 打开文件阶段只执行本地渲染；手动 START_ANALYSIS 返回 4 个正文块，APPLY_ANNOTATIONS 成功应用 1 个 CSS Highlight，代码、公式和图表源码未进入采集文本。
- T5: 安全样例确认 onclick 与 javascript: href 被移除、script 未执行、iframe 无 srcdoc 且 sandbox 为空权限集；作用域内恶意 CSS 未隐藏 LinguaMark 控件。
- T6: 无效 Mermaid 仅保留对应源码块，另外两个图表继续渲染，临时错误节点为 0；整体失败路径在替换正文前完成构建并保留原始页面。
- T7: 同一 Chromium 烟雾检查在 HTTP 页面仍只采集预期正文并排除 pre 代码块，返回 1 个既有文本块。
- T8: 双扩展临时 profile 复现 docu.md 覆盖 LinguaMark；关闭 docu.md 本地文件接管后恢复 article#write，用户随后确认当前 Chrome 已正常加载 Lightmind Viewer。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: 用户当前 Chrome 原始失败路径已恢复正常；此前类型检查、构建、依赖审计、14 类图表、安全、手动标记与 HTTP 烟雾验证仍有效，冲突隔离实验确认根因。
