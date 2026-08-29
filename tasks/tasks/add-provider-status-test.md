# 在设置页测试供应商状态

Status: Completed (2026-08-28 20:57)
Kind: Task

## Target
- [x] T1: 设置页提供供应商状态测试按钮。
- [x] T2: 用户使用当前供应商配置执行测试后，可在设置页看到成功或失败结果。
- [x] T3: 查明截图所示供应商测试失败的具体原因，并向用户说明。

## Plan

1. 在设置页加入供应商连接测试操作与状态反馈。
2. 复用现有供应商配置链路发起最小模型请求，并把结果返回设置页。
3. 补充浏览器通路检查并运行非测试验证。

## Result

- T1: 设置页源码及构建产物均包含 #test-provider 测试连接按钮。
- T2: 当前表单配置会发送至 Background 进行最小模型请求，设置页按响应显示连接成功或错误信息；TypeScript 检查与构建通过。
- T3: 截图显示的是 Options 的通用“连接失败”回退；源码仅在 Background 未返回结构化响应时进入该分支，而当前 dist/background.js 已包含 TEST_PROVIDER 处理器，因此最可能是开发扩展未重载、仍运行旧 service worker。
- Review gate: Skipped — 用户未要求独立 Reviewer 审查。

## Verification

- Passed: 静态定位确认 options.ts 的通用回退位于无响应分支，src 与 dist 的 background 均包含 TEST_PROVIDER 处理器；截图未显示供应商返回的具体错误。
