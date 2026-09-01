# 为 Markdown Viewer 增加阅读宽度切换

Status: Completed (2026-08-31 20:19)
Kind: Task

## Scope

- 包含：当前 Markdown 阅读器页面的固定宽度与整屏宽度切换。
- 不包含：跨页面或跨重启保存宽度偏好。

## Target
- [x] T1: Markdown 阅读器导航栏提供样式按钮，可在固定阅读宽度与整屏宽度之间切换。
- [x] T2: 切换后当前宽度模式具有明确的按钮状态，且不影响现有导航、目录和阅读内容。

## Plan

1. 在导航栏右侧加入宽度切换按钮并同步按钮文字、提示和按下状态。
2. 用页面状态类在现有固定宽度与可用整屏宽度间切换。
3. 验证两种宽度、窄屏回退、现有控件布局与构建检查。

## Result

- T1: 检查 src/markdown.ts、public/markdown.css 与构建产物：导航栏右侧宽度按钮切换 linguamark-full-width，CSS 在默认 min(980px, 100%-48px) 与内容区 100% 间切换。
- T2: 静态行为检查五项均为 true：默认固定宽度、仅切换 body 状态类、不重建内容、同步 aria-pressed、固定与整屏 CSS 均存在；窄屏操作按钮沿用图标布局。
- Review gate: Skipped — 用户未要求独立对抗审查。

## Verification

- Passed: npm run check、npm run build 与 git diff --check 通过；dist/markdown.js 与 dist/markdown.css 包含宽度按钮和两种宽度状态。
