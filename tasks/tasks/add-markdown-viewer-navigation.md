# 为 Markdown Viewer 增加导航与左侧目录

Status: Completed (2026-08-31 14:21)
Kind: Task

## Scope

- 包含：每篇本地 Markdown 自动生成的左侧标题目录、顶部导航栏、目录显隐控制与正文布局联动；桌面默认展开，窄屏默认收起。
- 不包含：Markdown 编辑、文件树或普通 HTTP/HTTPS 页面的导航 UI。

## Target
- [x] T1: 本地 Markdown Viewer 顶部显示与 Lightmind 风格一致的导航栏
- [x] T2: 每篇文档按标题层级自动生成左侧目录，点击目录项会滚动到对应标题，正文中的 `[TOC]` 占位不重复显示
- [x] T3: 顶部导航栏提供显示或隐藏左侧目录的控制；桌面默认展开、窄屏默认收起，正文布局随目录状态正确调整
- [x] T4: 现有 Markdown 渲染、安全处理、手动 LinguaMark 分析与 HTTP/HTTPS 页面行为保持不变

## Plan

1. 确认目录的默认显隐行为。
2. 比较可行布局并确定最小交互设计。
3. 实现导航、目录与布局联动。
4. 验证标题跳转、显隐状态及既有 Viewer 行为。

## Decisions

- 每篇文档自动生成目录；桌面默认展开，窄屏默认收起，正文中的 `[TOC]` 只作为兼容占位并移除。
- 采用顶部 sticky 导航栏加 CSS Grid 主区域；桌面目录占据左列，窄屏使用覆盖式抽屉，JavaScript 只负责生成目录和切换状态。

## Result

- T1: 1280px Chromium 截图与 computedStyle 确认顶部 Lightmind 导航栏存在且 position 为 sticky，显示目录按钮、文件名与 LinguaMark 品牌。
- T2: 含 `[TOC]` 的样例正文占位已移除并生成 5 个标题链接；不含 `[TOC]` 的 Mermaid gallery 也自动生成目录，点击 Mathematics 后标题停在 sticky 导航下方 75.8px。
- T3: 桌面初始 aria-expanded=true 且目录可见，切换后目录隐藏并让正文从 left=296 调整到 145；700px 初始收起，按钮打开抽屉与遮罩，点击条目后自动关闭。
- T4: 真实 Chromium 烟雾检查确认安全 HTML、相对资源、KaTeX、有效/无效 Mermaid、14 类图表、手动采集与 CSS Highlight 均正常；导航文字未进入模型采集，HTTP 页面仍返回唯一预期正文。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: npm run check、npm run build、npm audit --omit=dev、git diff --check、Context validate，以及桌面/窄屏/目录跳转/显隐/安全/手动分析/14 类图表/HTTP Chromium 烟雾检查均通过；未运行项目测试套件。
