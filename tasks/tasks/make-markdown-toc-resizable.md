# 让 Markdown 阅读器左侧目录可调整宽度

Status: Completed (2026-09-01 15:14)
Kind: Task

## Scope

- 包含：桌面端文档目录与目录文件树共用的左侧栏宽度调整。
- 不包含：跨页面或跨重启保存侧栏宽度。

## Target
- [x] T1: 用户可拖动左侧目录与正文之间的边界来调整目录宽度。

## Plan

1. 为共用侧栏边界增加指针与键盘可操作的宽度调节器。
2. 保持侧栏显隐、无目录状态与窄屏抽屉布局不变。
3. 运行类型检查、构建及静态行为检查。

## Result

- T1: Chromium 烟雾检查中拖动分隔器将侧栏从 272px 调整为 368px，正文网格同步更新。
- Review gate: Skipped — 用户未请求独立对抗性审查。

## Verification

- Passed: npm run check、npm run build、git diff --check、6/6 静态检查及 Chromium 拖动、键盘、窄屏、无目录检查均通过。
