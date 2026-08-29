# 设置 DeepSeek V4 Flash 默认模型并实测

Status: Completed (2026-08-28 17:47)
Kind: Task

## Target
- [x] T1: DeepSeek 预设默认使用 deepseek-v4-flash，同时保持 Base URL 和 Model ID 可编辑。
- [x] T2: 使用用户临时提供的 DeepSeek API Key 在加载 unpacked 扩展的 Chrome 中完成一次真实文章分析，并观察到标记渲染；API Key 不写入仓库、任务记录或日志。
- [x] T3: 测试结束后清理临时凭据与测试 profile，并确认仓库及构建产物不包含该 API Key。

## Plan

1. 将 DeepSeek 预设的默认 Model ID 更新为 `deepseek-v4-flash`，保持现有可编辑配置行为。
2. 构建扩展，在隔离的 Chrome for Testing profile 中临时写入用户凭据，并通过真实 DeepSeek 请求分析一个最小英文测试段落。
3. 观察 Content script 的句界与角色 Highlight，随后关闭测试浏览器、删除临时 profile／凭据并扫描仓库与构建产物。

## Result

- T1: src/contracts.ts 的 DeepSeek 预设已改为 deepseek-v4-flash；npm test 新增并通过默认模型断言，Base URL 与 Model ID 输入仍可编辑。
- T2: 隔离 Chrome for Testing 会话使用用户临时凭据调用真实 DeepSeek deepseek-v4-flash 成功：1 个段落完成分析，渲染 4 个句界、5 个主语 Highlight 和 5 个谓语 Highlight。
- T3: 实时测试关闭后已删除隔离 Chrome profile；凭据扫描确认 workspace 与 dist 均不包含 API Key。
- Review gate: Skipped — 用户未要求独立 Reviewer；已完成常规自审、真实供应商调用和凭据清理检查。

## Verification

- Passed: npm run check、6 个逻辑测试和 npm run build 通过；真实 DeepSeek V4 Flash Chrome 测试成功，凭据与临时 profile 清理验证通过。
