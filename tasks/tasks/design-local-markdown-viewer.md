# 设计本地 Markdown 阅读器能力

Status: Completed (2026-08-30 13:09)
Kind: Task

## Scope

- 包含：直接打开 `file:///.../*.md` 后自动渲染的本地 Markdown 阅读体验、Chrome 文件访问限制、尽量覆盖当前 Lightmind 主题定义的全部 Typora 渲染特性，以及渲染与现有 LinguaMark 分析能力的衔接。
- 不包含：本轮代码实现、第三方 Markdown 解析器选型落地、打开文件后自动调用模型分析，或执行 Markdown 内嵌的主动内容。

## Target
- [x] T1: 明确 Chrome 扩展渲染本地 Markdown 文件的可行性、必要权限与用户侧限制
- [x] T2: 给出满足直接打开本地 `.md` 后自动渲染这一体验的候选方案、权衡与推荐方向
- [x] T3: 识别当前使用的 Typora 主题，并盘点其定义的 Markdown 与扩展渲染特性
- [x] T4: 推荐设计尽量覆盖当前 Lightmind 主题中的全部 Typora 渲染特性，并明确浏览器中无法等价复现的边界
- [x] T5: 打开本地 Markdown 时只自动进行本地渲染，不上传正文或自动触发模型分析；分析继续由用户手动启动
- [x] T6: 原始 HTML 与 CSS 的视觉内容得到保留，但脚本和事件处理器不执行，iframe 受到隔离

## Plan

1. 确认用户期望的打开方式与阅读体验。
2. 核实 Chrome 本地文件权限及当前扩展兼容边界。
3. 比较候选方案并收敛推荐设计。

## Decisions

- 本机 Typora 当前启用 `Lightmind` 浅色主题；深色主题配置为 `Lightmind Dark`，但未启用深色或独立深色主题。
- 本地 Markdown 打开后只自动渲染；LinguaMark 模型分析保持手动触发。
- 原始 HTML/CSS 追求视觉兼容，但禁止脚本和事件处理器，并隔离 iframe。
- 采用原 `file://` 页面内原地渲染；不跳转到扩展 Viewer 页面，也不引入原生文件助手。
- 渲染管线采用成熟 Markdown 解析器与插件，并由打包后的 Mermaid、KaTeX 和代码高亮器完成增强；Lightmind 阅读样式作为扩展内固定快照。
- 兼容目标是阅读结果一致；Typora 侧边栏、源码模式、CodeMirror 编辑状态等编辑器专属行为不属于 Viewer。
- 整体解析失败时保留原始 Markdown；单个公式或图表失败时保留对应源码块，其余内容继续渲染。

## Result

- T1: Chrome 官方文档确认 file:///* 可由扩展匹配，但用户必须开启“允许访问文件网址”；当前 Manifest 仅匹配 HTTP/HTTPS。
- T2: 已比较原页渲染、独立 Viewer 与原生助手三种方案；用户确认采用原 file:// 页面内渲染。
- T3: 本机 Typora 偏好确认当前主题为 Lightmind 浅色；已完整检查 2668 行主题 CSS 并盘点阅读与扩展渲染特性。
- T4: 用户确认组件、数据流、特性覆盖、Typora 编辑器专属排除项及局部失败降级设计。
- T5: 用户选择仅自动本地渲染；最终设计明确模型分析保持手动触发且打开文件不上传正文。
- T6: 用户确认保留视觉 HTML/CSS，同时禁止脚本和事件处理器并隔离 iframe；安全验收项已定义。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: 设计已按四个分节逐项获得用户确认，并与当前扩展源码、Typora 配置/主题及 Chrome 官方权限文档交叉核对。
