# 隔离 Reader 页面打开状态

Status: Completed (2026-09-01 11:47)
Kind: Task

## Scope

- 包含：通过 Popup 新开的 Reader 页面初始状态，以及各 Reader 页面所选单文件和目录的相互隔离。
- 不包含：改变收藏与最近浏览的跨页面共享规则，或改变直接打开 `file://` Markdown 的行为。

## Target
- [x] T1: 同时打开多个 Reader 页面时，每个页面保持各自打开的文件或文件夹，不会因其他页面随后打开内容而改载最新项。
- [x] T2: 新打开的 Reader 页面默认显示空页面，不自动加载此前或最近打开的文件或文件夹。

## Plan

1. 移除 Popup 对既有 Reader 页面的复用，并定位目录状态串页的共享边界。
2. 将独立 Reader 的目录授权和读取限定在各自页面范围内，同时保留直接打开本地 Markdown 的既有行为。
3. 更新受影响的项目说明与上下文事实。
4. 运行类型检查、构建检查和差异审查，确认目标条件与相邻行为。

## Result

- T1: 源代码不变量检查确认 Popup 每次创建新 Reader，独立 Reader 的目录状态和文件读取均按发送方标签页 ID 隔离；TypeScript 检查与构建通过。
- T2: 独立 Reader 初始化只查询当前标签页专属目录键，不再读取默认或其他标签页目录；Popup 新建路径与源代码不变量检查通过。
- Review gate: Skipped — 用户未要求独立对抗审查；已完成本地差异自审。

## Verification

- Passed: npm run check、npm run build、源代码不变量检查、git diff --check 与 Context 校验均通过；按项目规则未运行自动化测试。
