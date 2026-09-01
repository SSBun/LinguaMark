# 增加解析预加载设置

Status: Completed (2026-08-29 22:34)
Kind: Task

## Scope

- 包括解析预加载设置的持久化、设置页控制和页面文本采集范围。
- 不改变模型供应商、分析协议或标记渲染规则。

## Target
- [x] T1: 启用预加载后，解析范围在当前可见区域下方向下扩展到按屏幕高度百分比配置的区域。
- [x] T2: 用户可以开启或关闭预加载，并配置预加载占屏幕高度的百分比；默认值为 30%。
- [x] T3: 关闭预加载时，解析范围保持为当前可见区域。
- [x] T4: 启用预加载后，每次滚动触发的增量扫描都会覆盖当前视口下方按配置比例扩展的区域，使继续向下滚动即将出现的内容提前完成解析。

## Plan

1. 复现滚动期间的增量扫描时序并定位预加载延迟的根因。
2. 恢复连续滚动期间的及时增量预加载，同时保持现有设置和采集边界不变。
3. 验证开启与关闭预加载的滚动行为，并运行类型检查、构建和差异检查。

## Result

- T1: 构建后的 dist/content.js 在 preload 开启时使用 innerHeight * (1 + preloadPercent / 100) 作为向下分析边界。
- T2: 设置页构建产物包含预加载开关和百分比输入；DisplaySettings 默认 preload=true、preloadPercent=30，并由 options.js 写入 chrome.storage.local。
- T3: 构建后的 dist/content.js 在 preload 关闭时直接使用 innerHeight，保留当前可见区域边界。
- T4: 聚焦 Chromium smoke 中，视口高度 600、目标 top=700 时，启用预加载会在连续滚动期间发送 1 次增量队列；关闭预加载时连续滚动期间及停止后均为 0 次。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: 修复前聚焦 smoke 为连续滚动期间 0 次、停止后 1 次；修复后开启时连续滚动期间 1 次、关闭时 0 次；npm run check、npm run build、git diff --check 均通过。按用户规则未运行项目测试套件。
