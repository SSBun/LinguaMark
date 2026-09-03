# 修复 Mermaid 图表渲染不完整

Status: Completed (2026-09-03 10:19)
Kind: Task

## Target
- [x] T1: Markdown 阅读器中的 Mermaid 图表完整显示，不裁切图中文字或内容。
- [x] T2: 用户最新截图中的 Mermaid 图表全部内容完整显示，不再有被裁切的文字或图形。

## Plan

1. 复现最新截图中的节点尾字符裁切并记录标签视口与文字尺寸。
2. 修复节点标签和连线标签共用的渲染后尺寸差异，避免逐图表打补丁。
3. 运行类型检查、构建和浏览器冒烟检查，并审查最终差异。

## Result

- T1: Chromium 复现图中“只认识抽象能力”和“只新增注册”均完整、居中显示，900px 与 1200px 视口下装饰内容可见且位于 SVG 边界内。
- T2: 正文 0.01em 字距已从 Mermaid HTML 标签隔离；截图对应 6 个节点的文字宽度与 foreignObject 宽度完全一致，尾字符完整显示。
- Review gate: Skipped — 用户未要求独立对抗审查；已完成根因、作用域和回归风险自查。

## Verification

- Passed: npm run check、npm run build、git diff --check 与 Context/Lessons 校验通过；整篇文档 129 个节点标签零裁切，14 个 gallery 面板零失败。
