# 在设置页增加收藏标签页

Status: Completed (2026-08-29 23:35)
Kind: Task

## Target
- [x] T1: 扩展设置页提供独立的收藏标签页，原有设置仍可访问。
- [x] T2: 收藏标签页列出全部本地收藏的特殊词汇、经典短语和句式，并按收藏日期分组。
- [x] T3: 新收藏会记录收藏时间；既有无时间数据不会丢失并仍会显示。

## Plan

1. 为收藏数据记录时间并兼容既有无时间收藏。
2. 在设置页加入设置／收藏标签切换与按日期分组列表。
3. 完成类型检查、生产构建与静态边界检查。

## Result

- T1: 设置页生成包包含设置／收藏两个 ARIA 标签页及对应面板，点击与方向键切换逻辑已通过类型检查。
- T2: 收藏页读取全部 learningFavorites，按本地日历日期倒序分组并显示词汇、短语、句式类型与说明。
- T3: 新收藏写入 collectedAt；共享读取器保留并去重既有收藏，无时间条目显示在“日期未知”组。
- Review gate: Skipped — 用户未要求独立 Reviewer 审批。

## Verification

- Passed: npm run check、npm run build、git diff --check、静态契约检查与 Context validate 均通过；按当前会话规则未运行测试套件。
