# 增加摘录类型开关

Status: Completed (2026-08-31 17:23)
Kind: Task

## Scope

- 增加特殊词汇、经典短语和代表性句式三个独立、持久化的摘录开关，旧设置继续默认全部开启。
- 开关仅影响后续分析产生的新摘录，不删除既有收藏，也不改变各类型的选取标准。

## Target
- [x] T1: 用户可分别开关单词、短语和句子摘录。
- [x] T2: 实际摘录结果遵循三个开关的启用状态。

## Plan

1. 在现有设置模型和设置页中加入三个摘录开关。
2. 让每次分析会话的模型请求与响应校验遵循已启用的摘录类型。
3. 执行类型检查与构建，并检查改动范围和兼容性。

## Result

- T1: 构建后的 Options page 显示单词、短语、句子三个独立 switch，浏览器检查确认三个控件存在且默认开启。
- T2: 行为冒烟检查确认 phrase-only 会话的 Prompt 仅启用 P=phrase，且响应中的 vocabulary、pattern 被过滤；全部关闭时 JSON Prompt 要求空 learningItems。
- Review gate: Skipped — 用户未要求独立审查。

## Verification

- Passed: npm run check、npm run build、git diff --check 与摘录设置/Prompt/过滤冒烟检查均通过。
