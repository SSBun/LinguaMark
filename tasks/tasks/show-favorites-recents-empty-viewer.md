# 在空白阅读器中央展示收藏与最近浏览

Status: Completed (2026-09-01 11:48)
Kind: Task

## Scope

- 包含：独立 Markdown Viewer 尚未选择文件或目录时的中央空状态。
- 不包含：已打开文档的正文布局或收藏数据结构变更。

## Target
- [x] T1: 新打开且尚未选择文件或目录的 Markdown Viewer 页面中央展示收藏列表和最近浏览列表。

## Plan

1. 在空状态复用现有收藏与最近浏览列表及打开行为。
2. 将空状态内容和两个列表作为一个响应式中央区域展示。
3. 生成扩展产物并执行静态验证。

## Result

- T1: 检查 src/markdown.ts、public/markdown.css 与构建产物：独立 Viewer 空状态中央创建全部收藏和最近浏览两组列表，复用现有存储内容、条目渲染及打开行为，并在窄屏切换为单列；npm run check、npm run build 与 7/7 静态检查通过。
- Review gate: Skipped — 用户未要求独立对抗审查。

## Verification

- Passed: npm run check、npm run build、7/7 源码及构建产物静态检查、目标文件行尾空白检查与 Context validate 均通过；按用户规则未运行测试套件。
