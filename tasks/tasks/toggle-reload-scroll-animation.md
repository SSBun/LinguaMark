# 增加重载滚动动画开关

Status: Completed (2026-09-01 20:38)
Kind: Task

## Scope

- 仅调整 Markdown Viewer 重载恢复滚动位置时的动画偏好；不改变浏览位置恢复本身。

## Target
- [x] T1: 用户可通过一个默认关闭的开关控制页面重载时列表恢复到上次浏览位置是否使用平滑动画。
- [x] T2: 关闭动画时，页面重载仍会恢复到上次浏览位置，但不显示平滑滚动动画。

## Plan

1. 在阅读器中提供可持久化的动画开关，并让初始状态与已保存偏好一致。
2. 仅在开关启用时应用平滑滚动，同时保留减弱动态效果偏好。
3. 核验默认关闭、开关状态、类型检查、构建与差异质量。

## Result

- T1: Chrome for Testing 最终冒烟确认新标签页开关默认 aria-checked=false；开启后经 hash 与文件切换、同标签页重载仍保持 true，并应用 smooth。
- T2: 长页面最终冒烟确认关闭与开启时分别恢复到 3200px 与 4700px；关闭为 auto、开启为 smooth，减少动态效果时强制 auto。
- Review gate: Skipped — 用户未要求独立审查；已完成本地对抗性复查并修正异步初始化与导航状态丢失方案。

## Verification

- Passed: npm run check、npm run build、git diff --check、6 项静态检查、file:// 会话存储检查、最终 Viewer 浏览器冒烟、375px 布局及 Context/Lessons 校验均通过；按项目规则未运行项目测试套件。
