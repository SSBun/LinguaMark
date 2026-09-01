# 避免已处理分析失败污染 Chrome 扩展错误

Status: Completed (2026-08-29 11:58)
Kind: Task

## Scope

- Included: Background、Popup、Content 与 Options 中已捕获失败的日志级别及脱敏详情；保留现有用户错误反馈。
- Excluded: 隐藏未捕获异常、改变模型／网络失败语义或清除用户现有 Chrome 错误记录。

## Target
- [x] T1: 已被应用捕获并反馈的分析失败不再因 console.error 记录而出现在 Chrome 扩展 Errors 页面。
- [x] T2: Background、Popup 与用户状态继续保留经过脱敏的具体失败原因，不再只显示 [object Object]。

## Plan

1. 复现截图流程并确认 Chrome 将已处理失败的 `console.error` 计入扩展 Errors。
2. 将所有已捕获失败复用现有 warning 日志通路，保留事件名和脱敏详情。
3. 用同一路径验证 Background／Popup 不再产生 error 级 Console 消息，并完成类型检查与构建。

## Decisions

- 根因是 Chrome 会把扩展上下文中的 `console.error` 计入扩展 Errors，即使异常已经被 `catch` 并反馈给用户；Errors 页面再把结构化详情显示成 `[object Object]`。
- 当前所有 `logError` 调用都位于已捕获或已降级路径，因此统一复用现有 `logWarn` 并移除 `logError`；真正未捕获的异常仍由 Chrome 原生错误机制暴露。

## Result

- T1: 同一 Chrome 失败路径修复前 Background／Popup 均产生 error 级消息；修复后均为 warning，errorMessageCount=0，且 src 中已无 logError／console.error。
- T2: 聚焦 Chrome smoke 读取到 Background 与 Popup 的结构化脱敏 reason 均为“请先打开模型设置并保存供应商配置”，并与 Popup 状态完全一致。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: npm run check、npm run build、git diff --check、静态无 console.error 检查与修复前后同路径 Chrome smoke 均通过。
