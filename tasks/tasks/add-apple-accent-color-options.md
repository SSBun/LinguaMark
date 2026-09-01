# 提供 Apple 系统强调色与自定义颜色

Status: Completed (2026-08-29 11:53)
Kind: Task

## Scope

- Included: 七种文本标记的 Apple 系统强调色预设、自定义 `#RRGGBB` 输入、已有颜色还原、持久化与实时应用。
- Excluded: 读取 macOS 当前强调色、动态明暗色解析和没有单一 Hex 值的“多彩”选项；不改变现有 DisplaySettings 存储结构。

## Target
- [x] T1: 七种文本标记的颜色选择器提供 Apple 系统强调色预设，并保留自定义颜色选项。
- [x] T2: 用户可输入有效 Hex 颜色字符串；预设或自定义颜色均会持久化并实时应用，已有颜色设置不会丢失。

## Plan

1. 用 Apple 固定强调色预设和自定义 Hex 输入替换原生颜色选择器。
2. 将已保存 Hex 值还原为匹配预设或自定义状态，并沿用现有存储与实时渲染通路。
3. 调整控件样式和聚焦检查，完成类型检查、构建与浏览器行为验证。

## Decisions

- 使用浏览器原生 `input[list]` 与共享 `datalist`，一个控件同时支持预设选择和自由 Hex 输入，不引入自定义颜色选择器或依赖。
- 固定预设采用 Apple 当前浅色系统色参考：蓝 `#0088FF`、紫 `#CB30E0`、粉 `#FF2D55`、红 `#FF383C`、橙 `#FF8D28`、黄 `#FFCC00`、绿 `#34C759`；石墨采用静态参考 `#98989D`。Apple 原生颜色会随系统与外观动态变化，Chrome 扩展无法解析 `NSColor.controlAccentColor`，因此不声称这些 Hex 会跟随系统变化。

## Result

- T1: 最新 dist 的七个颜色输入均关联共享 apple-accent-colors datalist；聚焦 Chrome smoke 观察到蓝、紫、粉、红、橙、黄、绿、石墨八个固定预设。
- T2: 聚焦 Chrome smoke 证明预设 #FF383C 实时应用，自定义 #abcdef 标准化为 #ABCDEF、重载后保留；无效 #12 未覆盖已应用颜色。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、git diff --check、Context validate、dist 静态检查与聚焦 Chrome 持久化／实时应用 smoke 均通过。
